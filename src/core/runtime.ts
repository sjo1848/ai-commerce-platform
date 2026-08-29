import { InMemoryAuditSink } from "./audit.js";
import { DeterministicModelRouter } from "./deterministic-model.js";
import { AgentCoreExecutor } from "./executor.js";
import { InMemoryIdempotencyStore } from "./idempotency.js";
import { ChatOrchestrator } from "./orchestrator.js";
import { PolicyEngine } from "./policy.js";
import { InMemorySessionStore, SessionManager } from "./session.js";
import { TenantResolver } from "./tenant-resolver.js";
import { ToolRegistry } from "./tool-registry.js";
import type { Actor, Channel, ExecutionContext, Tenant } from "./types.js";
import { InMemoryUsageSink } from "./usage.js";
import { FakeHmsAdapter } from "../adapters/fake-hms.js";

export type RuntimeConfig = {
  tenants: readonly Tenant[];
  now?: () => Date;
};

export class AgentCoreRuntime {
  readonly tenantResolver: TenantResolver;
  readonly sessions = new InMemorySessionStore();
  readonly sessionManager = new SessionManager(this.sessions);
  readonly registry = new ToolRegistry();
  readonly policy = new PolicyEngine();
  readonly audit = new InMemoryAuditSink();
  readonly usage = new InMemoryUsageSink();
  readonly idempotency = new InMemoryIdempotencyStore();
  readonly executor: AgentCoreExecutor;
  readonly orchestrator: ChatOrchestrator;
  private readonly now: () => Date;

  constructor(config: RuntimeConfig) {
    this.tenantResolver = new TenantResolver(config.tenants);
    this.now = config.now ?? (() => new Date());
    const hms = new FakeHmsAdapter();
    this.registry.register(hms.checkAvailabilityTool());
    this.registry.register(hms.getQuoteTool());
    this.executor = new AgentCoreExecutor(this.registry, this.policy, this.audit, this.usage, this.idempotency);
    this.orchestrator = new ChatOrchestrator(new DeterministicModelRouter(), this.registry, this.executor, this.usage, this.audit);
  }

  createContext(input: {
    tenantId: string;
    actor: Actor;
    channel: Channel;
    sessionId?: string;
    requestId?: string;
  }): ExecutionContext {
    const now = this.now();
    const tenant = this.tenantResolver.resolve(input.tenantId);
    const session = this.sessionManager.getOrCreate({
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
