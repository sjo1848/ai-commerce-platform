import { HmsServiceBindingAdapter, type HmsRpcService } from "./adapters/hms-service-binding.js";
import {
  DurableObjectApprovalStore,
  DurableObjectSessionStore,
  SessionDurableObject,
} from "./cloudflare/session-durable-object.js";
import { AgentCoreRuntime } from "./core/runtime.js";
import { createWebchatHandler } from "./webchat/handler.js";

export { SessionDurableObject };

type Env = {
  HMS: HmsRpcService;
  SESSIONS: DurableObjectNamespace<SessionDurableObject>;
};

const tenant = {
  id: "hotel-demo",
  slug: "hotel-demo",
  status: "active" as const,
  allowedToolIds: [
    "hms.checkAvailability",
    "hms.getQuote",
    "hms.createReservation",
    "hms.cancelReservation",
  ],
  toolPolicies: {
    "hms.checkAvailability": "auto" as const,
    "hms.getQuote": "auto" as const,
    "hms.createReservation": "approval" as const,
    "hms.cancelReservation": "approval" as const,
  },
};

let handle: ((request: Request) => Promise<Response>) | undefined;

function handler(env: Env): (request: Request) => Promise<Response> {
  if (handle) return handle;

  const hms = new HmsServiceBindingAdapter(env.HMS, {
    // Trusted deployment mapping. User/model input cannot choose this hotel id.
    "hotel-demo": { hotelId: "10000000-0000-0000-0000-000000000001" },
  });
  const runtime = new AgentCoreRuntime({
    tenants: [tenant],
    tools: [
      hms.checkAvailabilityTool(),
      hms.getQuoteTool(),
      hms.createReservationTool(),
      hms.cancelReservationTool(),
    ],
    sessionStore: new DurableObjectSessionStore(env.SESSIONS),
  });
  handle = createWebchatHandler(runtime, {
    fixedTenantId: "hotel-demo",
    fixedActorId: "visitor-demo",
    approvalStore: new DurableObjectApprovalStore(env.SESSIONS),
  });
  return handle;
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handler(env)(request);
  },
};
