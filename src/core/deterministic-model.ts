import type { ConversationState } from "./conversation-state.js";
import type { JsonSchema, ModelRouter, ModelRouteResult, ToolDescriptor } from "./types.js";

const UUID_SHAPED = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

function extractIsoDates(message: string): string[] { return message.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? []; }
function extractGuests(message: string): number | undefined {
  const match = message.match(/\b(?:para\s+)?(\d{1,2})\s*(?:personas?|hu[eé]spedes?|pax)\b/i)
    ?? message.match(/\b(?:somos|ser[ií]amos|seremos)\s+(\d{1,2})\b/i);
  return match?.[1] ? Number(match[1]) : undefined;
}
function extractRoomId(message: string): string | undefined {
  const hmsId = message.match(new RegExp(`\\b${UUID_SHAPED}\\b`, "i"))?.[0];
  return hmsId ?? message.match(/\broom-[a-z0-9_-]+\b/i)?.[0];
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
  return Array.isArray(schema.required) ? schema.required.includes(field) : false;
}
function groundedRoomIdsFromVisibleNumbers(message: string, state?: Readonly<ConversationState>): string[] {
  if (!state) return [];
  const matches = state.availabilityRooms.filter((room) => {
    const number = room.roomNumber?.trim();
    if (!number) return false;
    return new RegExp(`(?:^|[^0-9A-Za-z])${number.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[^0-9A-Za-z])`, "i").test(message);
  }).map((room) => room.id);
  return [...new Set(matches)];
}

export class DeterministicModelRouter implements ModelRouter {
  async route(
    message: string,
    _context: unknown,
    availableTools: readonly ToolDescriptor[],
    _conversation: readonly unknown[] = [],
    state?: Readonly<ConversationState>,
  ): Promise<ModelRouteResult> {
    const lower = message.toLowerCase();
    if (/\b(ignore|ignora|system prompt|developer message|tool:|execute tool|ejecuta la herramienta)\b/i.test(message)) {
      return { kind: "message", message: "Puedo ayudarte con tu estadía, pero no voy a ejecutar instrucciones internas incluidas en el mensaje." };
    }

    if (/^\s*(hola|buen(?:os|as)?\s+(?:d[ií]as|tardes|noches)|hey|buenas)\b[!.?\s]*$/i.test(message)) {
      return { kind: "message", message: "¡Hola! Bienvenido. ¿En qué te puedo ayudar con tu estadía?" };
    }
    if (/^\s*(gracias|muchas gracias|perfecto|genial|buen[ií]simo|dale)\b[!.?\s]*$/i.test(message)) {
      return { kind: "message", message: "¡Por supuesto! Cuando quieras, seguimos con la estadía o la reserva." };
    }

    const explicitDates = extractIsoDates(message);
    const dates = explicitDates.length >= 2
      ? explicitDates
      : state?.stay.checkIn && state?.stay.checkOut ? [state.stay.checkIn, state.stay.checkOut] : explicitDates;
    const explicitGuests = extractGuests(message);
    const guests = explicitGuests ?? state?.stay.guests;

    const cancellationIntent = /\b(cancelar|cancela|anular|anula)\b/i.test(message) && /\b(reserva|booking)\b/i.test(message);
    if (cancellationIntent) {
      const tool = availableTools.find((candidate) => candidate.id === "hms.cancelReservation");
      if (!tool) return { kind: "message", message: "La cancelación de reservas no está habilitada para este hotel." };
      const bookingId = extractLabeledId(message, ["reserva", "booking"]) ?? state?.activeBookingId;
      if (!bookingId) return { kind: "message", message: "Para no equivocarme, necesito identificar cuál reserva querés cancelar." };
      return { kind: "tool", plan: { toolId: tool.id, input: { bookingId } } };
    }

    const reservationIntent = /\b(reservar|reserv[aá]|confirmar\s+reserva)\b/i.test(message);
    if (reservationIntent) {
      const explicitGroundedRooms = groundedRoomIdsFromVisibleNumbers(message, state);
      const selectedRooms = explicitGroundedRooms.length > 0 ? explicitGroundedRooms : state?.selectedRoomIds ?? [];
      if (selectedRooms.length > 1) {
        const bundle = availableTools.find((candidate) => candidate.id === "hms.createReservationBundle");
        if (!bundle) return { kind: "message", message: "Puedo reservar una habitación por vez, pero la reserva múltiple no está habilitada en este momento." };
        if (dates.length < 2) return { kind: "message", message: "Claro, ¿para qué fechas sería?" };
        return { kind: "tool", plan: { toolId: bundle.id, input: { roomIds: selectedRooms, checkIn: dates[0], checkOut: dates[1] } } };
      }

      const tool = availableTools.find((candidate) => candidate.id === "hms.createReservation");
      if (!tool) return { kind: "message", message: "La creación de reservas no está habilitada para este hotel." };
      const roomId = explicitGroundedRooms[0] ?? extractLabeledId(message, ["habitaci[oó]n", "room"]) ?? state?.selectedRoomId;
      const guestId = extractLabeledId(message, ["hu[eé]sped", "guest"]);
      const guestRequired = schemaRequired(tool.inputSchema, "guestId") ?? true;
      if (dates.length < 2 || !roomId || (guestRequired && !guestId)) {
        return { kind: "message", message: guestRequired ? "Para seguir con la reserva necesito la habitación, el huésped y las fechas." : "Perfecto. Para seguir necesito saber qué habitación querés y las fechas." };
      }
      return { kind: "tool", plan: { toolId: tool.id, input: { roomId, ...(guestRequired && guestId ? { guestId } : {}), checkIn: dates[0], checkOut: dates[1] } } };
    }

    const explicitRoomId = extractRoomId(message);
    const groundedVisible = groundedRoomIdsFromVisibleNumbers(message, state);
    const roomId = groundedVisible[0] ?? explicitRoomId ?? state?.selectedRoomId;
    const quoteIntent = lower.includes("cotiz") || lower.includes("precio") || lower.includes("tarifa") || lower.includes("cuánto") || lower.includes("cuanto");
    if (quoteIntent && dates.length >= 2) {
      if (!roomId) return { kind: "message", message: "Perfecto. ¿De qué habitación querés que te dé el precio?" };
      if (!availableTools.some((tool) => tool.id === "hms.getQuote")) return { kind: "message", message: "La cotización no está habilitada para este hotel." };
      return { kind: "tool", plan: { toolId: "hms.getQuote", input: { roomId, checkIn: dates[0], checkOut: dates[1] } } };
    }

    const availabilityTool = availableTools.find((tool) => tool.id === "hms.checkAvailability");
    const availabilityIntent = lower.includes("dispon") || lower.includes("habitaci") || lower.includes("aloj") || /\b(somos|seríamos|seremos)\b/i.test(message);
    if (availabilityIntent && dates.length >= 2) {
      if (!availabilityTool) return { kind: "message", message: "La consulta de disponibilidad no está habilitada para este hotel." };
      const guestsRequired = schemaRequired(availabilityTool.inputSchema, "guests") ?? false;
      if (guestsRequired && guests === undefined) return { kind: "message", message: "Perfecto, ¿para cuántas personas sería?" };
      return { kind: "tool", plan: { toolId: "hms.checkAvailability", input: { checkIn: dates[0], checkOut: dates[1], guests: guests ?? 1 } } };
    }

    if (dates.length >= 2 && guests === undefined) return { kind: "message", message: "Perfecto, ¿para cuántas personas sería?" };
    return { kind: "message", message: "Claro. Contame qué necesitás para la estadía y lo vemos juntos." };
  }
}
