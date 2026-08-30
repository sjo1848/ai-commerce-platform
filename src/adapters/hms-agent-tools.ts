import type { HmsServiceBindingAdapter } from "./hms-service-binding.js";
import type { JsonSchema, ToolDefinition } from "../core/types.js";

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

const reservationSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    guestId: { type: "string", minLength: 1, description: "ID de huésped ya conocido por la sesión/flujo" },
    roomId: { type: "string", minLength: 1, description: "ID de habitación proveniente de HMS/tool context" },
    checkIn: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    checkOut: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    notes: { type: ["string", "null"], maxLength: 500 },
  },
  required: ["guestId", "roomId", "checkIn", "checkOut"],
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

export function hmsAgentTools(adapter: HmsServiceBindingAdapter) {
  return [
    withSchema(adapter.checkAvailabilityTool(), availabilitySchema),
    withSchema(adapter.getQuoteTool(), quoteSchema),
    withSchema(adapter.createReservationTool(), reservationSchema),
    withSchema(adapter.cancelReservationTool(), cancellationSchema),
  ] as const;
}
