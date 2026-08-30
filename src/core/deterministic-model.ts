import type { ModelRouter, ModelRouteResult, ToolDescriptor } from "./types.js";

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
      if (!availableTools.some((tool) => tool.id === "hms.cancelReservation")) {
        return { kind: "message", message: "La cancelación de reservas no está habilitada para este negocio." };
      }
      const bookingId = extractLabeledId(message, ["reserva", "booking"]);
      if (!bookingId) return { kind: "message", message: "Para cancelar necesito el identificador explícito de la reserva." };
      return { kind: "tool", plan: { toolId: "hms.cancelReservation", input: { bookingId } } };
    }

    const reservationIntent = /\b(reservar|reserva|confirmar\s+reserva)\b/i.test(message);
    if (reservationIntent) {
      if (!availableTools.some((tool) => tool.id === "hms.createReservation")) {
        return { kind: "message", message: "La creación de reservas no está habilitada para este negocio." };
      }
      const roomId = extractLabeledId(message, ["habitaci[oó]n", "room"]);
      const guestId = extractLabeledId(message, ["hu[eé]sped", "guest"]);
      if (dates.length < 2 || !roomId || !guestId) {
        return { kind: "message", message: "Para reservar necesito habitación, huésped y dos fechas explícitas." };
      }
      return {
        kind: "tool",
        plan: {
          toolId: "hms.createReservation",
          input: { roomId, guestId, checkIn: dates[0], checkOut: dates[1] },
        },
      };
    }

    const roomId = extractRoomId(message);
    const quoteIntent = lower.includes("cotiz") || lower.includes("precio") || lower.includes("tarifa") || lower.includes("cuánto") || lower.includes("cuanto");

    if (quoteIntent && dates.length >= 2) {
      if (!roomId) {
        return { kind: "message", message: "Para cotizar necesito el identificador de la habitación además de las fechas." };
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

    const guests = extractGuests(message) ?? 1;
    if ((lower.includes("dispon") || lower.includes("habitaci") || lower.includes("aloj")) && dates.length >= 2) {
      if (!availableTools.some((tool) => tool.id === "hms.checkAvailability")) {
        return { kind: "message", message: "La consulta de disponibilidad no está habilitada para este negocio." };
      }
      return { kind: "tool", plan: { toolId: "hms.checkAvailability", input: { checkIn: dates[0], checkOut: dates[1], guests } } };
    }

    return { kind: "message", message: "Indicame fechas en formato AAAA-MM-DD y cantidad de personas para disponibilidad; habitación y fechas para cotizar; o habitación, huésped y fechas para reservar." };
  }
}
