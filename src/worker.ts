import { HmsServiceBindingAdapter, type HmsRpcService } from "./adapters/hms-service-binding.js";
import { hmsAgentTools } from "./adapters/hms-agent-tools.js";
import { WorkersAiModelProvider, type WorkersAiBinding } from "./adapters/cloudflare-workers-ai.js";
import {
  DurableObjectApprovalStore,
  DurableObjectConversationStore,
  DurableObjectExperimentNeuronBudgetStore,
  DurableObjectReservationOperationStore,
  DurableObjectSessionStore,
  SessionDurableObject,
} from "./cloudflare/session-durable-object.js";
import { ConsoleAuditSink } from "./core/audit.js";
import { ConversationBackedStateStore } from "./core/conversation-state.js";
import { DeterministicModelRouter } from "./core/deterministic-model.js";
import { LLMModelRouter } from "./core/llm-model.js";
import { LLMGroundedResponder } from "./core/model-responder.js";
import { DurableExperimentBudgetProvider, type ValidationNeuronBudgetConfig } from "./core/neuron-budget.js";
import { AgentCoreRuntime } from "./core/runtime.js";
import { ConsoleUsageSink } from "./core/usage.js";
import { createWebchatHandler } from "./webchat/handler.js";

export { SessionDurableObject };

type Env = {
  AI: WorkersAiBinding;
  HMS: HmsRpcService;
  SESSIONS: DurableObjectNamespace<SessionDurableObject>;
  /** Evaluation-only deployment override. Omit in normal staging/production config to retain the default model. */
  ACP_MODEL_ID?: string;
  /** Validation-harness-only JSON configuration. It is intentionally absent from normal deployments. */
  ACP_VALIDATION_NEURON_BUDGET?: string;
  /** Server-owned validation ledger key; never derived from a conversation session. */
  ACP_VALIDATION_EXPERIMENT_ID?: string;
  /** Opt-in Gateway affinity for validation only; absent/false preserves production behavior. */
  ACP_VALIDATION_SESSION_AFFINITY?: string;
};

const tenant = {
  id: "hotel-demo",
  slug: "hotel-demo",
  status: "active" as const,
  allowedToolIds: [
    "hms.checkAvailability",
    "hms.getQuote",
    "hms.createReservation",
    "hms.createMultiReservation",
    "hms.cancelReservation",
    "hms.cancelMultiReservation",
  ],
  toolPolicies: {
    "hms.checkAvailability": "auto" as const,
    "hms.getQuote": "auto" as const,
    "hms.createReservation": "approval" as const,
    "hms.createMultiReservation": "approval" as const,
    "hms.cancelReservation": "approval" as const,
    "hms.cancelMultiReservation": "approval" as const,
  },
};

const stagingIdentity = {
  guestIdByTenantActor: {
    "hotel-demo": {
      "visitor-demo": "12000000-0000-0000-0000-000000000001",
    },
  },
};

let handle: ((request: Request) => Promise<Response>) | undefined;

function validationNeuronBudget(value: string | undefined): ValidationNeuronBudgetConfig | undefined {
  if (!value) return undefined;
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error("ACP_VALIDATION_NEURON_BUDGET must be valid JSON"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("ACP_VALIDATION_NEURON_BUDGET must be an object");
  const config = parsed as Record<string, unknown>;
  const number = (key: string, optional = false): number | undefined => {
    const raw = config[key];
    if (raw === undefined && optional) return undefined;
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) throw new Error(`ACP_VALIDATION_NEURON_BUDGET.${key} must be a finite non-negative number`);
    return raw;
  };
  const required = {
    maxNeuronsPerRun: number("maxNeuronsPerRun")!,
    configuredAvailableBudget: number("configuredAvailableBudget")!,
    configuredReserve: number("configuredReserve")!,
    conservativeExpectedCost: number("conservativeExpectedCost")!,
  };
  const observedLocalDayNeurons = number("observedLocalDayNeurons", true);
  return observedLocalDayNeurons === undefined ? required : { ...required, observedLocalDayNeurons };
}

function validationSessionAffinity(value: string | undefined): boolean {
  if (value === undefined || value === "") return false;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error("ACP_VALIDATION_SESSION_AFFINITY must be true or false");
}

function handler(env: Env): (request: Request) => Promise<Response> {
  if (handle) return handle;
  const reservationOperations = new DurableObjectReservationOperationStore(env.SESSIONS);
  const hms = new HmsServiceBindingAdapter(env.HMS, {
    "hotel-demo": { hotelId: "10000000-0000-0000-0000-000000000001" },
  }, reservationOperations);
  const usage = new ConsoleUsageSink();
  const audit = new ConsoleAuditSink();
  const workersAiProvider = new WorkersAiModelProvider(env.AI, {
    ...(env.ACP_MODEL_ID ? { model: env.ACP_MODEL_ID } : {}),
    enableSessionAffinity: validationSessionAffinity(env.ACP_VALIDATION_SESSION_AFFINITY),
  });
  // Only an explicitly configured validation deployment uses this durable, experiment-scoped guard.
  const validationBudget = validationNeuronBudget(env.ACP_VALIDATION_NEURON_BUDGET);
  if (Boolean(validationBudget) !== Boolean(env.ACP_VALIDATION_EXPERIMENT_ID)) throw new Error("ACP_VALIDATION_NEURON_BUDGET and ACP_VALIDATION_EXPERIMENT_ID must be configured together");
  const provider = validationBudget && env.ACP_VALIDATION_EXPERIMENT_ID
    ? new DurableExperimentBudgetProvider(workersAiProvider, new DurableObjectExperimentNeuronBudgetStore(env.SESSIONS, env.ACP_VALIDATION_EXPERIMENT_ID), {
      configuredMaxNeurons: validationBudget.maxNeuronsPerRun,
      configuredReserve: validationBudget.configuredReserve,
      conservativeNextCallAllowance: validationBudget.conservativeExpectedCost,
    })
    : workersAiProvider;
  const model = new LLMModelRouter(provider, new DeterministicModelRouter(), usage);
  const responder = new LLMGroundedResponder(provider, undefined, usage);
  const conversationStore = new DurableObjectConversationStore(env.SESSIONS);
  const runtime = new AgentCoreRuntime({
    tenants: [tenant],
    tools: hmsAgentTools(hms, stagingIdentity),
    sessionStore: new DurableObjectSessionStore(env.SESSIONS),
    conversationStore,
    conversationStateStore: new ConversationBackedStateStore(conversationStore),
    auditSink: audit,
    usageSink: usage,
    model,
    responder,
  });
  handle = createWebchatHandler(runtime, {
    fixedTenantId: "hotel-demo",
    fixedActorId: "visitor-demo",
    approvalStore: new DurableObjectApprovalStore(env.SESSIONS),
  });
  return handle;
}

export default {
  fetch(request: Request, env: Env): Promise<Response> { return handler(env)(request); },
};
