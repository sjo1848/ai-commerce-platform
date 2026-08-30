import { InMemoryAuditSink } from "./audit.js";
import { InMemoryConversationStore, type ConversationStore } from "./conversation.js";
import { DeterministicModelRouter } from "./deterministic-model.js";
import { AgentCoreExecutor } from "./executor.js";
import { InMemoryIdempotencyStore } from "./idempotency.js";
import { DeterministicGroundedResponder, type ModelResponder } from "./model-responder.js";
import { ChatOrchestrator } from "./orchestrator.js";
import { PolicyEngine } from "./policy.js";
import { InMemorySessionStore, SessionManager, type SessionStore } from "./session.js";
import { TenantResolver } from "./tenant-resolver.js";
import { ToolRegistry } from "./tool-registry.js";
import type { Actor, Channel, ExecutionContext, ModelRouter, Tenant, ToolDefinition } from "./types.js";
import { InMemoryUsageSink, type UsageSink } from "./usage.js";
import { FakeHmsAdapter } from "../adapters/fake-hms.js";

export type RuntimeConfig = {
  tenants: readonly Tenant[];
  tools?: readonly ToolDefinition<any, any>[];
  now?: () => Date;
  sessionStore?: SessionStore;
  conversationStore?: ConversationStore;
  usageSink?: UsageSink;
  model?: ModelRouter;
  responder?: ModelResponder;
};

export class AgentCoreRuntime {
  readonly tenantResolver: TenantResolver;
  readonly sessions: SessionStore;
  readonly sessionManager: SessionManager;
  readonly conversation: ConversationStore;
  readonly registry = new ToolRegistry();
  readonly policy = new PolicyEngine();
  readonly audit = new InMemoryAuditSink();
  readonly usage: UsageSink;
  readonly idempotency = new InMemoryIdempotencyStore();
  readonly executor: AgentCoreExecutor;
  readonly orchestrator: ChatOrchestrator;
  private readonly now: () => Date;

  constructor(config: RuntimeConfig) {
    this.tenantResolver = new TenantResolver(config.tenants);
    this.now = config.now ?? (() => new Date());
    this.sessions = config.sessionStore ?? new InMemorySessionStore();
    this.sessionManager = new SessionManager(this.sessions);
    this.conversation = config.conversationStore ?? new InMemoryConversationStore();
    this.usage = config.usageSink ?? new InMemoryUsageSink();

    if (config.tools) {
      for (const tool of config.tools) this.registry.register(tool);
    } else {
      // Phase-1 reproducibility: the fake remains the default only when no real
      // vertical tools are injected by the deployment runtime.
      const hms = new FakeHmsAdapter();
      this.registry.register(hms.checkAvailabilityTool());
      this.registry.register(hms.getQuoteTool());
    }

    this.executor = new AgentCoreExecutor(this.registry, this.policy, this.audit, this.usage, this.idempotency);
    this.orchestrator = new ChatOrchestrator(
      config.model ?? new DeterministicModelRouter(),
      config.responder ?? new DeterministicGroundedResponder(),
      this.registry,
      this.executor,
      this.usage,
      this.audit,
      this.conversation,
    );
  }

  async createContext(input: {
    tenantId: string;
    actor: Actor;
    channel: Channel;
    sessionId?: string;
    requestId?: string;
  }): Promise<ExecutionContext> {
    const now = this.now();
    const tenant = this.tenantResolver.resolve(input.tenantId);
    const session = await this.sessionManager.getOrCreate({
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      tenant,
      actor: input.actor,
      channel: input.channel,
      now,
    });
    return {
      requestId: input.requestId ?? crypto.randomUUID(),
      tenant,
      actor: input.actor,
      session,
      now: now.toISOString(),
    };
  }
}
