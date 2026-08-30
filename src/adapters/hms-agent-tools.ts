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

const reservationBundleSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    roomIds: {
      type: "array",
      minItems: 2,
      maxItems: 5,
      uniqueItems: true,
      items: { type: "string", minLength: 1, description: "IDs autoritativos resueltos por el Core desde la selección conversacional" },
    },
    checkIn: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    checkOut: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    allocations: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          roomId: { type: "string", minLength: 1 },
          guests: { type: "integer", minimum: 1, maximum: 20 },
        },
        required: ["roomId", "guests"],
      },
      description: "Distribución declarada por el usuario; no implica validación de capacidad HMS.",
    },
    notes: { type: ["string", "null"], maxLength: 500 },
  },
  required: ["roomIds", "checkIn", "checkOut"],
};

const cancellationSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    bookingId: { type: "string", minLength: 1, description: "ID de una reserva propiedad de la sesión confiable" },
  },
  required: ["bookingId"],
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

function canonicalTrustedReservationInput(
  input: unknown,
  context: ExecutionContext | undefined,
  identity: HmsAgentIdentityConfig,
): { ok: true; guestId: string; raw: Record<string, unknown> } | { ok: false; message: string } {
  if (!context) return { ok: false, message: "Trusted execution context is required" };
  const guestId = trustedGuestId(identity, context);
  if (!guestId) return { ok: false, message: "Guest identity is not configured for this tenant and actor" };
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, message: "Invalid reservation input" };
  const raw = input as Record<string, unknown>;
  if (raw.guestId !== undefined && raw.guestId !== guestId) return { ok: false, message: "Guest identity cannot be selected by the request" };
  return { ok: true, guestId, raw };
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
      const trusted = canonicalTrustedReservationInput(input, context, identity);
      if (!trusted.ok) return trusted;
      const canonical = {
        roomId: trusted.raw.roomId,
        checkIn: trusted.raw.checkIn,
        checkOut: trusted.raw.checkOut,
        ...(trusted.raw.notes !== undefined ? { notes: trusted.raw.notes } : {}),
        guestId: trusted.guestId,
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

function createReservationBundleTool(
  adapter: HmsServiceBindingAdapter,
  identity: HmsAgentIdentityConfig,
): ToolDefinition<any, any> {
  const base = adapter.createReservationBundleTool();
  return {
    ...base,
    inputSchema: reservationBundleSchema,
    validateInput(input, context) {
      const trusted = canonicalTrustedReservationInput(input, context, identity);
      if (!trusted.ok) return trusted;
      const canonical = {
        roomIds: trusted.raw.roomIds,
        checkIn: trusted.raw.checkIn,
        checkOut: trusted.raw.checkOut,
        ...(trusted.raw.allocations !== undefined ? { allocations: trusted.raw.allocations } : {}),
        ...(trusted.raw.notes !== undefined ? { notes: trusted.raw.notes } : {}),
        guestId: trusted.guestId,
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

export function hmsAgentTools(adapter: HmsServiceBindingAdapter, identity: HmsAgentIdentityConfig = {}) {
  return [
    withSchema(adapter.checkAvailabilityTool(), availabilitySchema),
    withSchema(adapter.getQuoteTool(), quoteSchema),
    createReservationTool(adapter, identity),
    createReservationBundleTool(adapter, identity),
    withSchema(adapter.cancelReservationTool(), cancellationSchema),
  ] as const;
}
