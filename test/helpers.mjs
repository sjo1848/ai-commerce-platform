import { AgentCoreRuntime } from "../dist/core/runtime.js";

export const tenantA = {
  id: "hotel-a",
  slug: "hotel-a",
  status: "active",
  allowedToolIds: ["hms.checkAvailability", "hms.getQuote"],
  toolPolicies: { "hms.checkAvailability": "auto", "hms.getQuote": "auto" },
};

export const tenantB = {
  id: "hotel-b",
  slug: "hotel-b",
  status: "active",
  allowedToolIds: [],
};

export const actor = {
  id: "visitor-1",
  type: "customer",
  roles: ["customer"],
  permissions: ["hms.availability.read", "hms.quote.read"],
};

export function runtime() {
  return new AgentCoreRuntime({ tenants: [tenantA, tenantB], now: () => new Date("2026-08-29T13:00:00.000Z") });
}
