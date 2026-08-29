import { AgentCoreRuntime } from "./core/runtime.js";
import { createWebchatHandler } from "./webchat/handler.js";

const runtime = new AgentCoreRuntime({
  tenants: [
    {
      id: "hotel-demo",
      slug: "hotel-demo",
      status: "active",
      allowedToolIds: ["hms.checkAvailability", "hms.getQuote"],
      toolPolicies: {
        "hms.checkAvailability": "auto",
        "hms.getQuote": "auto",
      },
    },
  ],
});

const handle = createWebchatHandler(runtime);

export default {
  fetch(request: Request): Promise<Response> {
    return handle(request);
  },
};
