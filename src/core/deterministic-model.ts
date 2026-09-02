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

function explicitNaturalRoomNumbers(message: string): {
  numbers: string[];
  overflow: boolean;
  partial: boolean;
  explicitRoomQuantity: boolean;
  requestedRoomCount: number | undefined;
  explicitRoomExclusion: boolean;
} {
  const numbers: string[] = [];
  const selected = new Set<string>();
  let partial = false;
  let explicitRoomQuantity = false;
  let requestedRoomCount: number | undefined;
  let explicitRoomExclusion = false;
  const numericRoom = "\\d{1,5}(?![-\\dA-Za-zÁÉÍÓÚáéíóúÑñ])";
  const listSeparator = "(?:\\s*,\\s*(?:(?:y|e)\\s+)?|\\s+(?:y|e)\\s+)";
  const namedPattern = new RegExp(
    `\\b(?:habitaci[oó]n(?:es)?|rooms?)\\s*((?:${numericRoom})(?:${listSeparator}(?:(?:habitaci[oó]n(?:es)?|rooms?|la|las)\\s*)?${numericRoom})*)`,
    "gi",
  );
  const articlePattern = new RegExp(
    `\\b(?:la|las)\\s*((?:${numericRoom})(?:${listSeparator}(?:(?:la|las)\\s*)?${numericRoom})*)`,
    "gi",
  );
  const residualRoomContinuation = new RegExp(
    `^\\s*(?:(?:(?:[,;/+]|(?:y|e|o|u|and|or)\\b)\\s*)+|(?:junto\\s+con)\\s+)(?:(?:habitaci[oó]n(?:es)?|rooms?|la|las)\\s*)?${numericRoom}`,
    "i",
  );
  const articleRoomCountTail = /^\s*(?:habitaci[oó]n(?:es)?|rooms?)\b/i;
  const articleOrdinalRoomCountTail = /^\s*(?:(?:primer|segund|tercer|cuart|quint|sext|s[eé]ptim|octav|noven|d[eé]cim|[uú]ltim)(?:a|as|o|os)|first|second|third|last)\s+(?:habitaci[oó]n(?:es)?|rooms?)\b/i;
  const articleQuantityTail = /^\s*(?:habitaci[oó]n(?:es)?|rooms?|personas?|hu[eé]spedes?|pax|adultos?|niñ[oa]s?|menores?|noches?|d[ií]as?|horas?|minutos?|a\.?m\.?|p\.?m\.?|hs?\.?|a(?:ñ|n)os?|mes(?:es)?|camas?|plazas?|de\s+la\s+(?:mañana|tarde|noche|madrugada)|de\s+(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre))\b/i;
  const articleTimeTail = /^\s*:\s*[0-5]\d\b/;

  const isExcludedMention = (index: number): boolean => {
    const prefix = message.slice(0, index);
    const boundary = Math.max(
      prefix.lastIndexOf(";"),
      prefix.lastIndexOf(","),
      prefix.lastIndexOf("."),
      prefix.lastIndexOf("!"),
      prefix.lastIndexOf("?"),
    );
    const clausePrefix = prefix.slice(boundary + 1).trim();
    if (/^no(?!\s+solo\b)\b/i.test(clausePrefix)) return true;
    if (/^(?:pero\s+)?no\s+quier(?:o|e|en|emos)\s*$/i.test(clausePrefix)) return true;
    if (/(?:^|\s)(?:en\s+vez\s+de|en\s+lugar\s+de)\s*$/i.test(clausePrefix)) return true;
    return /(?:^|\s)(?:no|excepto|menos)\s*$/i.test(clausePrefix) || /^(?:excepto|menos)\b/i.test(clausePrefix);
  };

  const remove = (value: string): void => {
    if (!selected.delete(value)) return;
    const index = numbers.indexOf(value);
    if (index >= 0) numbers.splice(index, 1);
  };

  const mentions = [
    ...Array.from(message.matchAll(namedPattern), (match) => ({ match, articlePrefixed: false })),
    ...Array.from(message.matchAll(articlePattern), (match) => ({ match, articlePrefixed: true })),
  ].sort((left, right) => (left.match.index ?? 0) - (right.match.index ?? 0));

  for (const { match, articlePrefixed } of mentions) {
    const matchIndex = match.index ?? 0;
    const matchEnd = matchIndex + match[0].length;
    const tail = message.slice(matchEnd);
    const values = match[1]?.match(/\d{1,5}/g) ?? [];
    const ordinalRoomCount = articleOrdinalRoomCountTail.test(tail);
    if (articlePrefixed && (articleQuantityTail.test(tail) || articleTimeTail.test(tail) || ordinalRoomCount)) {
      if (articleRoomCountTail.test(tail) || ordinalRoomCount) {
        explicitRoomQuantity = true;
        if (values.length === 1) requestedRoomCount = Number(values[0]);
      }
      continue;
    }

    if (residualRoomContinuation.test(tail)) partial = true;

    if (isExcludedMention(matchIndex)) {
      explicitRoomExclusion = true;
      for (const value of values) remove(value);
      continue;
    }

    for (const value of values) {
      if (!selected.has(value)) {
        selected.add(value);
        numbers.push(value);
      }
    }
  }

  return { numbers, overflow: numbers.length > 10, partial, explicitRoomQuantity, requestedRoomCount, explicitRoomExclusion };
}

function groundedNaturalRoomSelection(
  message: string,
  state: Readonly<ConversationState> | undefined,
): { explicit: boolean; roomIds: string[]; unresolved: boolean } {
  const naturalNumbers = explicitNaturalRoomNumbers(message);
  const roomNumbers = naturalNumbers.numbers;
  if (roomNumbers.length === 0) {
    if (naturalNumbers.explicitRoomQuantity || naturalNumbers.explicitRoomExclusion) {
      return { explicit: true, roomIds: [], unresolved: true };
    }
    return { explicit: false, roomIds: [], unresolved: false };
  }

  const byNumber = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const room of state?.availabilityRooms ?? []) {
    if (!room.roomNumber) continue;
    const prior = byNumber.get(room.roomNumber);
    if (prior && prior !== room.id) ambiguous.add(room.roomNumber);
    else byNumber.set(room.roomNumber, room.id);
  }

  const roomIds: string[] = [];
  const seenIds = new Set<string>();
  let unresolved = naturalNumbers.overflow
    || naturalNumbers.partial
    || (naturalNumbers.requestedRoomCount !== undefined && naturalNumbers.requestedRoomCount !== roomNumbers.length);
  for (const roomNumber of roomNumbers) {
    const id = ambiguous.has(roomNumber) ? undefined : byNumber.get(roomNumber);
    if (!id) {
      unresolved = true;
      continue;
    }
    if (!seenIds.has(id)) {
      seenIds.add(id);
      roomIds.push(id);
    }
  }
  return { explicit: true, roomIds, unresolved };
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

    const cancellationIntent = /\b(cancelar|cancela|anular|anula)\b/i.test(message) && /\b(reserva|booking)\b/i.test(message);
    if (cancellationIntent) {
      const tool = availableTools.find((candidate) => candidate.id === "hms.cancelReservation");
      if (!tool) return { kind: "message", purpose: "unsupported", message: "La cancelación de reservas no está habilitada para este negocio." };
      const bookingId = extractLabeledId(message, ["reserva", "booking"]) ?? state?.activeBookingId;
      if (!bookingId) {
        return {
          kind: "message",
          purpose: "clarification",
          missing: ["booking"],
          message: "¿Qué reserva querés cancelar? Necesito identificarla de forma inequívoca.",
        };
      }
      return { kind: "tool", plan: { toolId: tool.id, input: { bookingId } } };
    }

    const reservationIntent = /\b(?:reservar|reserva|reservame|reserváme|reservamela|reservámela|reservanos|reservános|confirmar\s+reserva)\b/i.test(message);
    if (reservationIntent) {
      const naturalSelection = groundedNaturalRoomSelection(message, state);
      if (naturalSelection.explicit && naturalSelection.unresolved) {
        return {
          kind: "message",
          purpose: "clarification",
          missing: ["selection"],
          message: "No puedo identificar con seguridad todas las habitaciones que nombraste. Decime cuáles querés elegir.",
        };
      }
      const selectedRoomIds = naturalSelection.explicit ? naturalSelection.roomIds : (state?.selectedRoomIds ?? []);
      const multiRoom = selectedRoomIds.length > 1 || (state?.requestedRoomCount ?? 0) > 1;
      if (multiRoom) {
        if (selectedRoomIds.length < 2) {
          return {
            kind: "message",
            purpose: "clarification",
            missing: ["selection"],
            message: "¿Qué habitaciones querés elegir?",
          };
        }
        if (dates.length < 2) {
          return {
            kind: "message",
            purpose: "clarification",
            missing: ["dates"],
            message: "¿Para qué fechas sería?",
          };
        }
        const multiTool = availableTools.find((candidate) => candidate.id === "hms.createMultiReservation");
        if (!multiTool) {
          return { kind: "message", purpose: "unsupported", message: "La reserva conjunta no está habilitada para este negocio." };
        }
        return {
          kind: "tool",
          plan: {
            toolId: multiTool.id,
            input: { roomIds: [...selectedRoomIds], checkIn: dates[0], checkOut: dates[1] },
          },
          ...(naturalSelection.explicit ? { statePatch: { selectedRoomIds: [...selectedRoomIds] } } : {}),
        };
      }
      const tool = availableTools.find((candidate) => candidate.id === "hms.createReservation");
      if (!tool) return { kind: "message", purpose: "unsupported", message: "La creación de reservas no está habilitada para este negocio." };
      const roomId = naturalSelection.roomIds[0] ?? extractLabeledId(message, ["habitaci[oó]n", "room"]) ?? state?.selectedRoomId;
      const guestId = extractLabeledId(message, ["hu[eé]sped", "guest"]);
      const guestRequired = schemaRequired(tool.inputSchema, "guestId") ?? true;
      if (dates.length < 2 || !roomId || (guestRequired && !guestId)) {
        const missing = [
          ...(dates.length < 2 ? ["dates" as const] : []),
          ...(!roomId ? ["room" as const] : []),
        ];
        return {
          kind: "message",
          purpose: "clarification",
          missing,
          message: guestRequired ? "Para reservar necesito identificar habitación, huésped y fechas." : "Para reservar necesito identificar la habitación y las fechas.",
        };
      }
      return {
        kind: "tool",
        plan: { toolId: tool.id, input: { roomId, ...(guestRequired && guestId ? { guestId } : {}), checkIn: dates[0], checkOut: dates[1] } },
        ...(naturalSelection.explicit ? { statePatch: { selectedRoomIds: [roomId] } } : {}),
      };
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