import type { DependencyPath } from "./contracts.js";

export type HotelCapabilityKey =
  | "availability"
  | "quote"
  | "reserve_single"
  | "reserve_multi"
  | "cancel_single"
  | "cancel_multi";

export type HotelCapabilityBinding = {
  key: HotelCapabilityKey;
  capabilityId: string;
  contractIdentity: string;
  effectClass: "read" | "write";
  dependencyPaths: readonly DependencyPath[];
};

export type HotelTaskDefinition = {
  id: "hotel_task_v1";
  contractIdentity: "hotel_task_v1@1";
  bindings: Readonly<Record<HotelCapabilityKey, HotelCapabilityBinding>>;
};

export type DomainCapabilities = {
  domain: "hotel";
  definitionId: HotelTaskDefinition["id"];
  definitionContractIdentity: HotelTaskDefinition["contractIdentity"];
  enabled: Readonly<Partial<Record<HotelCapabilityKey, HotelCapabilityBinding>>>;
};

const binding = (
  key: HotelCapabilityKey,
  capabilityId: string,
  effectClass: "read" | "write",
  dependencyPaths: readonly DependencyPath[],
): HotelCapabilityBinding => ({
  key,
  capabilityId,
  contractIdentity: `${capabilityId}@hms-agent-v1`,
  effectClass,
  dependencyPaths,
});

export const HOTEL_TASK_DEFINITION_V1: HotelTaskDefinition = {
  id: "hotel_task_v1",
  contractIdentity: "hotel_task_v1@1",
  bindings: {
    availability: binding("availability", "hms.checkAvailability", "read", [
      "lifecycle",
      "user.stay.checkIn",
      "user.stay.checkOut",
      "user.stay.guests",
    ]),
    quote: binding("quote", "hms.getQuote", "read", [
      "lifecycle",
      "user.stay.checkIn",
      "user.stay.checkOut",
      "control.groundedSelection",
    ]),
    reserve_single: binding("reserve_single", "hms.createReservation", "write", [
      "lifecycle",
      "user.stay.checkIn",
      "user.stay.checkOut",
      "control.groundedSelection",
      "user.operationIntent",
    ]),
    reserve_multi: binding("reserve_multi", "hms.createMultiReservation", "write", [
      "lifecycle",
      "user.stay.checkIn",
      "user.stay.checkOut",
      "control.groundedSelection",
      "user.operationIntent",
    ]),
    cancel_single: binding("cancel_single", "hms.cancelReservation", "write", [
      "lifecycle",
      "control.groundedBookingTarget",
      "user.operationIntent",
    ]),
    cancel_multi: binding("cancel_multi", "hms.cancelMultiReservation", "write", [
      "lifecycle",
      "observations.booking",
      "user.operationIntent",
    ]),
  },
};

export const HOTEL_CAPABILITY_KEYS = Object.freeze([
  "availability",
  "quote",
  "reserve_single",
  "reserve_multi",
  "cancel_single",
  "cancel_multi",
] as const);

/**
 * Build the semantic capability view consumed by the deterministic Planner.
 * This expresses technical/domain availability only. It is NOT actor
 * authorization and contains no Policy outcome.
 */
export function hotelDomainCapabilities(
  enabledKeys: readonly HotelCapabilityKey[] = HOTEL_CAPABILITY_KEYS,
  definition: HotelTaskDefinition = HOTEL_TASK_DEFINITION_V1,
): DomainCapabilities {
  const enabled: Partial<Record<HotelCapabilityKey, HotelCapabilityBinding>> = {};
  for (const key of enabledKeys) enabled[key] = definition.bindings[key];
  return {
    domain: "hotel",
    definitionId: definition.id,
    definitionContractIdentity: definition.contractIdentity,
    enabled,
  };
}
