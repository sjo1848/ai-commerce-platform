import { CoreError } from "../core/errors.js";
import type { ExecutionContext, JsonSchema, ToolDefinition } from "../core/types.js";
import type { HmsServiceBindingAdapter } from "./hms-service-binding.js";

const availabilitySchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    checkIn: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "Fecha de entrada YYYY-MM-DD" },
    checkOut: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "Fecha de salida YYYY-MM-DD" },
    guests: { type: "integer", minimum: 1, maximum: 20 },
  },
  required: ["checkIn", "checkOut", "guests"],
};

const quoteSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    roomId: { type: "string", minLength: 1, description: "ID de habitación proveniente de HMS/tool context" },
    checkIn: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    checkOut: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
  },
  required: ["roomId", "checkIn", "checkOut"],
};

// guestId is intentionally absent: the authenticated/server-pinned actor identity
// resolves it before validation and the canonical resolved value is fingerprinted.
const reservationSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    roomId: { type: "string", minLength: 1, description: "ID de habitación proveniente de HMS/tool context" },
    checkIn: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    checkOut: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    notes: { type: ["string", "null"], maxLength: 500 },
  },
  required: ["roomId", "checkIn", "checkOut"],
};

// R2.5 roomIds/checkIn/checkOut are server-grounded from durable conversation
// state. They stay out of the model-visible schema so the model cannot author the
// trusted reservation set that the approval fingerprint protects.
const multiReservationSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    notes: { type: ["string", "null"], maxLength: 500 },
  },
};

const cancellationSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    bookingId: { type: "string", minLength: 1, description: "ID de una reserva propiedad de la sesión confiable" },
  },
  required: ["bookingId"],
};

// Group booking IDs are server-grounded from the current reservation-group
// state. The LLM only chooses the semantic intent; it never supplies the set.
const multiCancellationSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {},
};

function withSchema<I, O>(tool: ToolDefinition<I, O>, inputSchema: JsonSchema): ToolDefinition<I, O> {
  return { ...tool, inputSchema };
}

export type HmsAgentIdentityConfig = {
  /** Server-owned tenant+actor identity mapping. Never model/user input. */
  guestIdByTenantActor?: Readonly<Record<string, Readonly<Record<string, string>>>>;
};

function trustedGuestId(identity: HmsAgentIdentityConfig, context: ExecutionContext): string | undefined {
  const value = identity.guestIdByTenantActor?.[context.tenant.id]?.[context.actor.id]?.trim();
  return value || undefined;
}

function assertTrustedGuest(raw: Record<string, unknown>, guestId: string) {
  if (raw.guestId !== undefined && raw.guestId !== guestId) {
    return { ok: false as const, message: "Guest identity cannot be selected by the request" };
  }
  return undefined;
}

function createReservationTool(
  adapter: HmsServiceBindingAdapter,
  identity: HmsAgentIdentityConfig,
): ToolDefinition<any, any> {
  const base = adapter.createReservationTool();
  return {
    ...base,
    inputSchema: reservationSchema,
    validateInput(input, context) {
      if (!context) return { ok: false, message: "Trusted execution context is required" };
      const guestId = trustedGuestId(identity, context);
      if (!guestId) return { ok: false, message: "Guest identity is not configured for this tenant and actor" };
      if (!input || typeof input !== "object") return { ok: false, message: "Invalid reservation input" };
      const raw = input as Record<string, unknown>;
      const rejected = assertTrustedGuest(raw, guestId);
      if (rejected) return rejected;
      const canonical = {
        roomId: raw.roomId,
        checkIn: raw.checkIn,
        checkOut: raw.checkOut,
        ...(raw.notes !== undefined ? { notes: raw.notes } : {}),
        guestId,
      };
      return base.validateInput(canonical, context);
    },
    async execute(input, context, meta) {
      const expectedGuestId = trustedGuestId(identity, context);
      if (!expectedGuestId || input.guestId !== expectedGuestId) {
        throw new CoreError("FORBIDDEN", "Reservation guest identity does not match trusted tenant/actor binding", 403);
      }
      return base.execute(input, context, meta);
    },
  };
}

function createMultiReservationTool(
  adapter: HmsServiceBindingAdapter,
  identity: HmsAgentIdentityConfig,
): ToolDefinition<any, any> {
  const base = adapter.createMultiReservationTool();
  const availability = adapter.checkAvailabilityTool();
  return {
    ...base,
    inputSchema: multiReservationSchema,
    validateInput(input, context) {
      if (!context) return { ok: false, message: "Trusted execution context is required" };
      const guestId = trustedGuestId(identity, context);
      if (!guestId) return { ok: false, message: "Guest identity is not configured for this tenant and actor" };
      if (!input || typeof input !== "object") return { ok: false, message: "Invalid multi-room reservation input" };
      const raw = input as Record<string, unknown>;
      const rejected = assertTrustedGuest(raw, guestId);
      if (rejected) return rejected;
      const canonical = {
        roomIds: raw.roomIds,
        checkIn: raw.checkIn,
        checkOut: raw.checkOut,
        ...(raw.notes !== undefined ? { notes: raw.notes } : {}),
        guestId,
      };
      return base.validateInput(canonical, context);
    },
    async execute(input, context, meta) {
      const expectedGuestId = trustedGuestId(identity, context);
      if (!expectedGuestId || input.guestId !== expectedGuestId) {
        throw new CoreError("FORBIDDEN", "Reservation guest identity does not match trusted tenant/actor binding", 403);
      }
      // Fresh transactional preflight immediately before the composite mutation.
      // Capacity is not modeled yet, so guests=1 is only a schema placeholder;
      // this gate verifies that every exact approved room still exists in HMS
      // availability for the exact approved date range.
      const fresh = await availability.execute({ checkIn: input.checkIn, checkOut: input.checkOut, guests: 1 }, context, {});
      const availableIds = new Set(fresh.rooms.map((room) => room.id));
      const staleRoomIds = input.roomIds.filter((roomId: string) => !availableIds.has(roomId));
      if (staleRoomIds.length > 0) {
        throw new CoreError("CONFLICT", `Approved room selection is stale: ${staleRoomIds.join(", ")}`, 409);
      }
      return base.execute(input, context, meta);
    },
  };
}

export function hmsAgentTools(adapter: HmsServiceBindingAdapter, identity: HmsAgentIdentityConfig = {}) {
  return [
    withSchema(adapter.checkAvailabilityTool(), availabilitySchema),
    withSchema(adapter.getQuoteTool(), quoteSchema),
    createReservationTool(adapter, identity),
    createMultiReservationTool(adapter, identity),
    withSchema(adapter.cancelReservationTool(), cancellationSchema),
    withSchema(adapter.cancelMultiReservationTool(), multiCancellationSchema),
  ] as const;
}
