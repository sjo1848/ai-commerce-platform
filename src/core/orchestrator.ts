import { CoreError } from "./errors.js";
import type { AuditSink } from "./audit.js";
import type { AgentCoreExecutor } from "./executor.js";
import type { ModelRouter, ExecutionContext } from "./types.js";
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
    private readonly maxMessageChars = 2_000,
    private readonly maxToolCalls = 2,
  ) {}

  async chat(message: string, context: ExecutionContext): Promise<ChatResult> {
    const normalized = message.trim();
    if (!normalized) throw new CoreError("BAD_REQUEST", "Message is required", 400);
    if (normalized.length > this.maxMessageChars) throw new CoreError("LIMIT_EXCEEDED", "Message too long", 413);

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
    const route = await this.model.route(normalized, context, tools);
    if (route.kind === "message") return { message: route.message, sessionId: context.session.id };

    if (this.maxToolCalls < 1) throw new CoreError("LIMIT_EXCEEDED", "Tool-call limit reached", 429);
    const visible = tools.some((tool) => tool.id === route.plan.toolId);
    if (!visible) {
      await this.audit.record({
        timestamp: context.now,
        requestId: context.requestId,
        tenantId: context.tenant.id,
        actorId: context.actor.id,
        sessionId: context.session.id,
        toolId: route.plan.toolId,
        status: "denied",
        detail: "model_requested_non_visible_tool",
      });
      throw new CoreError("TOOL_NOT_ALLOWED", "Requested tool is not available", 403);
    }

    const data = await this.executor.execute(route.plan.toolId, route.plan.input, context, {
      ...(route.plan.idempotencyKey ? { idempotencyKey: route.plan.idempotencyKey } : {}),
    });
    return {
      message: "Operación completada.",
      sessionId: context.session.id,
      data,
    };
  }
}
