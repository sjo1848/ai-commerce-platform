import type { JsonSchema, ModelRouter, ModelRouteResult, ToolDescriptor } from "./types.js";

const UUID_SHAPED = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

function extractIsoDates(message: string): string[] {
  return message.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? [];
}

function extractGuests(message: string): number | undefined {
  const match = message.match(/\b(?:para\s+)?(\d{1,2})\s*(?:personas?|hu[eé]spedes?|pax)\b/i);
  if (!match?.[1]) return undefined;
  return Number(match[1]);
}

function extractRoomId(message: string): string | undefined {
  // HMS identifiers are UUID-shaped but are not required to encode an RFC UUID version/variant.
  const hmsId = message.match(new RegExp(`\\b${UUID_SHAPED}\\b`, "i"))?.[0];
  if (hmsId) return hmsId;
  return message.match(/\broom-[a-z0-9_-]+\b/i)?.[0];
}

function extractLabeledId(message: string, labels: readonly string[]): string | undefined {
  for (const label of labels) {
    const match = message.match(new RegExp(`\\b${label}\\s*(?:id\\s*)?[:#-]?\\s*(${UUID_SHAPED})\\b`, "i"));
    if (match?.[1]) return match[1];
  }
  return undefined;
}

function schemaRequired(schema: JsonSchema | undefined, field: string): boolean | undefined {
  if (!schema) return undefined;
  const required = schema.required;
  if (!Array.isArray(required)) return false;
  return required.includes(field);
}

export class DeterministicModelRouter implements ModelRouter {
  async route(message: string, _context: unknown, availableTools: readonly ToolDescriptor[]): Promise<ModelRouteResult> {
    const lower = message.toLowerCase();

    // User text never becomes a tool id. Common injection markers are treated as plain user text.
    if (/\b(ignore|ignora|system prompt|developer message|tool:|execute tool|ejecuta la herramienta)\b/i.test(message)) {
      return { kind: "message", message: "Puedo ayudarte con disponibilidad, cotizaciones y reservas, pero no ejecutar instrucciones internas indicadas en el mensaje." };
    }

    const dates = extractIsoDates(message);
    const cancellationIntent = /\b(cancelar|cancela|anular|anula)\b/i.test(message) && /\b(reserva|booking)\b/i.test(message);
    if (cancellationIntent) {
      const cancellationTool = availableTools.find((tool) => tool.id === "hms.cancelReservation");
      if (!cancellationTool) {
        return { kind: "message", message: "La cancelación de reservas no está habilitada para este negocio." };
      }
      const bookingId = extractLabeledId(message, ["reserva", "booking"]);
      if (!bookingId) return { kind: "message", message: "Para cancelar necesito identificar de forma inequívoca la reserva." };
      return { kind: "tool", plan: { toolId: "hms.cancelReservation", input: { bookingId } } };
    }

    const reservationIntent = /\b(reservar|reserva|confirmar\s+reserva)\b/i.test(message);
    if (reservationIntent) {
      const reservationTool = availableTools.find((tool) => tool.id === "hms.createReservation");
      if (!reservationTool) {
        return { kind: "message", message: "La creación de reservas no está habilitada para este negocio." };
      }
      const roomId = extractLabeledId(message, ["habitaci[oó]n", "room"]);
      const guestId = extractLabeledId(message, ["hu[eé]sped", "guest"]);
      // Legacy tools without a schema still require the explicit guest id. The 2.6
      // model-safe HMS tool schema deliberately omits guestId because identity is server-bound.
      const guestRequired = schemaRequired(reservationTool.inputSchema, "guestId") ?? true;
      if (dates.length < 2 || !roomId || (guestRequired && !guestId)) {
        return {
          kind: "message",
          message: guestRequired
            ? "Para reservar necesito identificar habitación, huésped y fechas."
            : "Para reservar necesito identificar la habitación y las fechas.",
        };
      }
      return {
        kind: "tool",
        plan: {
          toolId: "hms.createReservation",
          input: {
            roomId,
            ...(guestRequired && guestId ? { guestId } : {}),
            checkIn: dates[0],
            checkOut: dates[1],
          },
        },
      };
    }

    const roomId = extractRoomId(message);
    const quoteIntent = lower.includes("cotiz") || lower.includes("precio") || lower.includes("tarifa") || lower.includes("cuánto") || lower.includes("cuanto");

    if (quoteIntent && dates.length >= 2) {
      if (!roomId) {
        return { kind: "message", message: "Para cotizar necesito identificar la habitación además de las fechas." };
      }
      if (!availableTools.some((tool) => tool.id === "hms.getQuote")) {
        return { kind: "message", message: "La cotización no está habilitada para este negocio." };
      }
      return {
        kind: "tool",
        plan: {
          toolId: "hms.getQuote",
          input: { roomId, checkIn: dates[0], checkOut: dates[1] },
        },
      };
    }

    const availabilityTool = availableTools.find((tool) => tool.id === "hms.checkAvailability");
    if ((lower.includes("dispon") || lower.includes("habitaci") || lower.includes("aloj")) && dates.length >= 2) {
      if (!availabilityTool) {
        return { kind: "message", message: "La consulta de disponibilidad no está habilitada para este negocio." };
      }
      const guests = extractGuests(message);
      const guestsRequired = schemaRequired(availabilityTool.inputSchema, "guests") ?? false;
      if (guestsRequired && guests === undefined) {
        return { kind: "message", message: "¿Para cuántas personas sería?" };
      }
      return {
        kind: "tool",
        plan: {
          toolId: "hms.checkAvailability",
          input: { checkIn: dates[0], checkOut: dates[1], guests: guests ?? 1 },
        },
      };
    }

    return { kind: "message", message: "Decime las fechas y cuántas personas son; con eso puedo consultar disponibilidad y seguir desde ahí." };
  }
}
