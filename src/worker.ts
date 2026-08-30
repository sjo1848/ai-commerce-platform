import { HmsServiceBindingAdapter, type HmsRpcService } from "./adapters/hms-service-binding.js";
import { hmsAgentTools } from "./adapters/hms-agent-tools.js";
import { WorkersAiModelProvider, type WorkersAiBinding } from "./adapters/cloudflare-workers-ai.js";
import {
  DurableObjectApprovalStore,
  DurableObjectConversationStore,
  DurableObjectReservationOperationStore,
  DurableObjectSessionStore,
  SessionDurableObject,
} from "./cloudflare/session-durable-object.js";
import { DeterministicModelRouter } from "./core/deterministic-model.js";
import { LLMModelRouter } from "./core/llm-model.js";
import { LLMGroundedResponder } from "./core/model-responder.js";
import { AgentCoreRuntime } from "./core/runtime.js";
import { ConsoleUsageSink } from "./core/usage.js";
import { createWebchatHandler } from "./webchat/handler.js";

export { SessionDurableObject };

type Env = {
  AI: WorkersAiBinding;
  HMS: HmsRpcService;
  SESSIONS: DurableObjectNamespace<SessionDurableObject>;
};

const tenant = {
  id: "hotel-demo",
  slug: "hotel-demo",
  status: "active" as const,
  allowedToolIds: ["hms.checkAvailability", "hms.getQuote", "hms.createReservation", "hms.cancelReservation"],
  toolPolicies: {
    "hms.checkAvailability": "auto" as const,
    "hms.getQuote": "auto" as const,
    "hms.createReservation": "approval" as const,
    "hms.cancelReservation": "approval" as const,
  },
};

const stagingIdentity = {
  guestIdByActor: {
    // Synthetic HMS staging guest. This mapping is trusted deployment config,
    // not a model/user argument; production identity onboarding remains out of 2.6 scope.
    "visitor-demo": "12000000-0000-0000-0000-000000000001",
  },
};

let handle: ((request: Request) => Promise<Response>) | undefined;

function handler(env: Env): (request: Request) => Promise<Response> {
  if (handle) return handle;
  const reservationOperations = new DurableObjectReservationOperationStore(env.SESSIONS);
  const hms = new HmsServiceBindingAdapter(env.HMS, {
    "hotel-demo": { hotelId: "10000000-0000-0000-0000-000000000001" },
  }, reservationOperations);
  const usage = new ConsoleUsageSink();
  const provider = new WorkersAiModelProvider(env.AI);
  const model = new LLMModelRouter(provider, new DeterministicModelRouter(), usage);
  const responder = new LLMGroundedResponder(provider, undefined, usage);
  const runtime = new AgentCoreRuntime({
    tenants: [tenant],
    tools: hmsAgentTools(hms, stagingIdentity),
    sessionStore: new DurableObjectSessionStore(env.SESSIONS),
    conversationStore: new DurableObjectConversationStore(env.SESSIONS),
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
