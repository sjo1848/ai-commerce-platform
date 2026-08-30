import { CoreError } from "./errors.js";
import type { AuditSink } from "./audit.js";
import { serializeToolResult, type ConversationStore } from "./conversation.js";
import type { AgentCoreExecutor } from "./executor.js";
import type { ModelRouter, ExecutionContext, ToolExecutionMeta, ToolPlan } from "./types.js";
import type { ToolRegistry } from "./tool-registry.js";
import type { UsageSink } from "./usage.js";

export type ChatResult = {
  message: string;
  sessionId: string;
  data?: unknown;
};

export class ChatOrchestrator {
  constructor(
    private readonly model: ModelRouter,
    private readonly registry: ToolRegistry,
    private readonly executor: AgentCoreExecutor,
    private readonly usage: UsageSink,
    private readonly audit: AuditSink,
    private readonly conversation: ConversationStore,
    private readonly maxMessageChars = 2_000,
    private readonly maxToolCalls = 2,
  ) {}

  private async executePlan(plan: ToolPlan, context: ExecutionContext, trustedMeta: ToolExecutionMeta): Promise<ChatResult> {
    if (this.maxToolCalls < 1) throw new CoreError("LIMIT_EXCEEDED", "Tool-call limit reached", 429);
    const tools = this.registry.descriptorsFor(context.tenant);
    const visible = tools.some((tool) => tool.id === plan.toolId);
    if (!visible) {
      await this.audit.record({
        timestamp: context.now,
        requestId: context.requestId,
        tenantId: context.tenant.id,
        actorId: context.actor.id,
        sessionId: context.session.id,
        toolId: plan.toolId,
        status: "denied",
        detail: "model_requested_non_visible_tool",
      });
      throw new CoreError("TOOL_NOT_ALLOWED", "Requested tool is not available", 403);
    }

    // Approval and idempotency are trusted channel/runtime metadata; the plan cannot set them.
    const data = await this.executor.execute(plan.toolId, plan.input, context, trustedMeta);
    await this.conversation.append(context.session.id, {
      role: "tool",
      toolId: plan.toolId,
      content: serializeToolResult(data),
    });
    const message = "Operación completada.";
    await this.conversation.append(context.session.id, { role: "assistant", content: message });
    return { message, sessionId: context.session.id, data };
  }

  async executeApprovedPlan(plan: ToolPlan, context: ExecutionContext, trustedMeta: ToolExecutionMeta): Promise<ChatResult> {
    if (!trustedMeta.humanApproved || !trustedMeta.approvedOperationFingerprint) {
      throw new CoreError("FORBIDDEN", "Approved plan execution requires trusted approval metadata", 403);
    }
    return this.executePlan(plan, context, trustedMeta);
  }

  async chat(message: string, context: ExecutionContext, trustedMeta: ToolExecutionMeta = {}): Promise<ChatResult> {
    const normalized = message.trim();
    if (!normalized) throw new CoreError("BAD_REQUEST", "Message is required", 400);
    if (normalized.length > this.maxMessageChars) throw new CoreError("LIMIT_EXCEEDED", "Message too long", 413);

    const priorConversation = await this.conversation.list(context.session.id, 12);
    await this.conversation.append(context.session.id, { role: "user", content: normalized });
    await this.usage.record({
      timestamp: context.now,
      tenantId: context.tenant.id,
      sessionId: context.session.id,
      kind: "message",
      units: 1,
      estimatedCostUsd: 0,
    });

    const tools = this.registry.descriptorsFor(context.tenant);
    await this.usage.record({
      timestamp: context.now,
      tenantId: context.tenant.id,
      sessionId: context.session.id,
      kind: "model_route",
      units: 1,
      estimatedCostUsd: 0,
    });
    const route = await this.model.route(normalized, context, tools, priorConversation);
    if (route.kind === "message") {
      await this.conversation.append(context.session.id, { role: "assistant", content: route.message });
      return { message: route.message, sessionId: context.session.id };
    }
    return this.executePlan(route.plan, context, trustedMeta);
  }
}
