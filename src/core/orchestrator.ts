import { CoreError } from "./errors.js";
import type { AuditSink } from "./audit.js";
import { serializeToolResult, type ConversationStore } from "./conversation.js";
import {
  applyConversationStatePatch,
  CONVERSATION_STATE_TOOL_ID,
  enrichPlanInputFromState,
  InMemoryConversationStateStore,
  updateConversationStateFromTool,
  type ConversationStateStore,
} from "./conversation-state.js";
import type { AgentCoreExecutor } from "./executor.js";
import type { ModelResponder } from "./model-responder.js";
import type { ModelRouter, ExecutionContext, ModelConversationTurn, ToolExecutionMeta, ToolPlan } from "./types.js";
import type { ToolRegistry } from "./tool-registry.js";
import type { UsageSink } from "./usage.js";

export type ChatResult = {
  message: string;
  sessionId: string;
  data?: unknown;
};

function modelVisibleConversation(turns: readonly ModelConversationTurn[]): ModelConversationTurn[] {
  return turns.filter((turn) => turn.toolId !== CONVERSATION_STATE_TOOL_ID).slice(-12);
}

export class ChatOrchestrator {
  constructor(
    private readonly model: ModelRouter,
    private readonly responder: ModelResponder,
    private readonly registry: ToolRegistry,
    private readonly executor: AgentCoreExecutor,
    private readonly usage: UsageSink,
    private readonly audit: AuditSink,
    private readonly conversation: ConversationStore,
    private readonly conversationState: ConversationStateStore = new InMemoryConversationStateStore(),
    private readonly maxMessageChars = 2_000,
    private readonly maxToolCalls = 2,
  ) {}

  private async executePlan(plan: ToolPlan, context: ExecutionContext, trustedMeta: ToolExecutionMeta): Promise<ChatResult> {
    if (this.maxToolCalls < 1) throw new CoreError("LIMIT_EXCEEDED", "Tool-call limit reached", 429);
    const tools = this.registry.descriptorsFor(context.tenant);
    const visible = tools.some((tool) => tool.id === plan.toolId);
    if (!visible) {
      await this.audit.record({ timestamp: context.now, requestId: context.requestId, tenantId: context.tenant.id, actorId: context.actor.id, sessionId: context.session.id, toolId: plan.toolId, status: "denied", detail: "model_requested_non_visible_tool" });
      throw new CoreError("TOOL_NOT_ALLOWED", "Requested tool is not available", 403);
    }

    const data = await this.executor.execute(plan.toolId, plan.input, context, trustedMeta);
    const before = await this.conversationState.get(context.session.id);
    await this.conversationState.put(context.session.id, updateConversationStateFromTool(before, plan.toolId, plan.input, data));
    await this.conversation.append(context.session.id, { role: "tool", toolId: plan.toolId, content: serializeToolResult(data) });
    const groundedContext = modelVisibleConversation(await this.conversation.list(context.session.id, 32));
    const message = await this.responder.compose({ toolId: plan.toolId, data, conversation: groundedContext, context });
    await this.conversation.append(context.session.id, { role: "assistant", content: message });
    return { message, sessionId: context.session.id, data };
  }

  async executeApprovedPlan(plan: ToolPlan, context: ExecutionContext, trustedMeta: ToolExecutionMeta): Promise<ChatResult> {
    if (!trustedMeta.humanApproved || !trustedMeta.approvedOperationFingerprint) throw new CoreError("FORBIDDEN", "Approved plan execution requires trusted approval metadata", 403);
    return this.executePlan(plan, context, trustedMeta);
  }

  async chat(message: string, context: ExecutionContext, trustedMeta: ToolExecutionMeta = {}): Promise<ChatResult> {
    const normalized = message.trim();
    if (!normalized) throw new CoreError("BAD_REQUEST", "Message is required", 400);
    if (normalized.length > this.maxMessageChars) throw new CoreError("LIMIT_EXCEEDED", "Message too long", 413);

    const priorConversation = modelVisibleConversation(await this.conversation.list(context.session.id, 32));
    const priorState = await this.conversationState.get(context.session.id);
    await this.conversation.append(context.session.id, { role: "user", content: normalized });
    await this.usage.record({ timestamp: context.now, tenantId: context.tenant.id, sessionId: context.session.id, kind: "message", units: 1, estimatedCostUsd: 0 });

    const tools = this.registry.descriptorsFor(context.tenant);
    await this.usage.record({ timestamp: context.now, tenantId: context.tenant.id, sessionId: context.session.id, kind: "model_route", units: 1, estimatedCostUsd: 0 });
    const route = await this.model.route(normalized, context, tools, priorConversation, priorState);
    const nextState = applyConversationStatePatch(priorState, route.statePatch);
    await this.conversationState.put(context.session.id, nextState);

    if (route.kind === "message") {
      await this.conversation.append(context.session.id, { role: "assistant", content: route.message });
      return { message: route.message, sessionId: context.session.id };
    }

    const plan: ToolPlan = { toolId: route.plan.toolId, input: enrichPlanInputFromState(route.plan.toolId, route.plan.input, nextState) };
    return this.executePlan(plan, context, trustedMeta);
  }
}
