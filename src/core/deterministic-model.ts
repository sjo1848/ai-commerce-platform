import type { ConversationState } from "./conversation-state.js";
import type { JsonSchema, ModelRouter, ModelRouteResult, ToolDescriptor } from "./types.js";

const UUID_SHAPED = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

function extractIsoDates(message: string): string[] { return message.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? []; }
function extractGuests(message: string): number | undefined {
  const match = message.match(/\b(?:para\s+)?(\d{1,2})\s*(?:personas?|hu[eé]spedes?|pax)\b/i);
  return match?.[1] ? Number(match[1]) : undefined;
}
function extractRoomId(message: string): string | undefined {
  const hmsId = message.match(new RegExp(`\\b${UUID_SHAPED}\\b`, "i"))?.[0];
  return hmsId ?? message.match(/\broom-[a-z0-9_-]+\b/i)?.[0];
}
function schemaRequired(schema: JsonSchema | undefined, field: string): boolean | undefined {
  if (!schema) return undefined;
  return Array.isArray(schema.required) ? schema.required.includes(field) : false;
}

function isPureGreeting(message: string): boolean {
  return /^\s*(hola|buen(?:os)?\s+d[ií]as|buenas\s+tardes|buenas\s+noches|buenas)\s*[!.¡¿?]*\s*$/i.test(message);
}

function isPureThanks(message: string): boolean {
  return /^\s*(gracias|muchas\s+gracias|genial,?\s+gracias|perfecto,?\s+gracias|buen[ií]simo,?\s+gracias)\s*[!.¡¿?]*\s*$/i.test(message);
}

function isHelpRequest(message: string): boolean {
  return /\b(qu[eé]\s+pod[eé]s\s+hacer|en\s+qu[eé]\s+me\s+pod[eé]s\s+ayudar|c[oó]mo\s+me\s+pod[eé]s\s+ayudar|ayuda)\b/i.test(message);
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
      return {
        kind: "message",
        purpose: "policy",
        message: "Puedo ayudarte con la estadía, pero no ejecutar instrucciones internas indicadas en el mensaje.",
      };
    }

    if (isPureGreeting(message)) {
      return { kind: "message", purpose: "greeting", message: "¡Hola! Claro, decime en qué te puedo ayudar." };
    }
    if (isPureThanks(message)) {
      return { kind: "message", purpose: "social", message: "De nada. Cuando quieras, seguimos con la estadía." };
    }
    if (isHelpRequest(message)) {
      return {
        kind: "message",
        purpose: "help",
        message: "Puedo ayudarte a consultar disponibilidad y precios, y a preparar reservas o cancelaciones con confirmación.",
      };
    }

    const explicitDates = extractIsoDates(message);
    const dates = explicitDates.length >= 2
      ? explicitDates
      : state?.stay.checkIn && state?.stay.checkOut ? [state.stay.checkIn, state.stay.checkOut] : explicitDates;
    const explicitGuests = extractGuests(message);
    const guests = explicitGuests ?? state?.stay.guests;

    const reservationIntent = /\b(?:reservar|reserva|reservame|reserváme|reservamela|reservámela|reservanos|reservános|confirmar\s+reserva)\b/i.test(message);
    if (reservationIntent) {
      return { kind: "message", purpose: "clarification", missing: ["selection"], message: "Puedo preparar la reserva cuando el sistema confirme la selección estructurada de habitaciones." };
    }

    const explicitRoomId = extractRoomId(message);
    const roomId = explicitRoomId ?? state?.selectedRoomId;
    const quoteIntent = lower.includes("cotiz") || lower.includes("precio") || lower.includes("tarifa") || lower.includes("cuánto") || lower.includes("cuanto");
    if (quoteIntent && dates.length >= 2) {
      if (!roomId) {
        return {
          kind: "message",
          purpose: "clarification",
          missing: ["room"],
          message: "¿Qué habitación u opción querés cotizar?",
        };
      }
      if (!availableTools.some((tool) => tool.id === "hms.getQuote")) return { kind: "message", purpose: "unsupported", message: "La cotización no está habilitada para este negocio." };
      return { kind: "tool", plan: { toolId: "hms.getQuote", input: { roomId, checkIn: dates[0], checkOut: dates[1] } } };
    }

    const availabilityTool = availableTools.find((tool) => tool.id === "hms.checkAvailability");
    const availabilityIntent = lower.includes("dispon") || lower.includes("habitaci") || lower.includes("aloj") || /\b(somos|seríamos|seremos)\b/i.test(message);
    if (availabilityIntent && dates.length < 2) {
      return {
        kind: "message",
        purpose: "clarification",
        missing: ["dates"],
        message: "¿Para qué fechas sería la estadía?",
      };
    }
    if (availabilityIntent && dates.length >= 2) {
      if (!availabilityTool) return { kind: "message", purpose: "unsupported", message: "La consulta de disponibilidad no está habilitada para este negocio." };
      const guestsRequired = schemaRequired(availabilityTool.inputSchema, "guests") ?? false;
      if (guestsRequired && guests === undefined) {
        return {
          kind: "message",
          purpose: "clarification",
          missing: ["guests"],
          message: "¿Para cuántas personas sería?",
        };
      }
      return { kind: "tool", plan: { toolId: "hms.checkAvailability", input: { checkIn: dates[0], checkOut: dates[1], guests: guests ?? 1 } } };
    }

    if (dates.length >= 2 && guests === undefined) {
      return {
        kind: "message",
        purpose: "clarification",
        missing: ["guests"],
        message: "¿Para cuántas personas sería?",
      };
    }
    return {
      kind: "message",
      purpose: "help",
      message: "Decime qué necesitás para la estadía y sigo desde los datos que ya tenemos.",
    };
  }
}
