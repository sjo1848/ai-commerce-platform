import type { ModelRouter, ModelRouteResult, ToolDescriptor } from "./types.js";

function extractIsoDates(message: string): string[] {
  return message.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? [];
}

function extractGuests(message: string): number | undefined {
  const match = message.match(/\b(?:para\s+)?(\d{1,2})\s*(?:personas?|hu[eé]spedes?|pax)\b/i);
  if (!match?.[1]) return undefined;
  return Number(match[1]);
}

function extractRoomId(message: string): string | undefined {
  const uuid = message.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i)?.[0];
  if (uuid) return uuid;
  return message.match(/\broom-[a-z0-9_-]+\b/i)?.[0];
}

export class DeterministicModelRouter implements ModelRouter {
  async route(message: string, _context: unknown, availableTools: readonly ToolDescriptor[]): Promise<ModelRouteResult> {
    const lower = message.toLowerCase();

    // User text never becomes a tool id. Common injection markers are treated as plain user text.
    if (/\b(ignore|ignora|system prompt|developer message|tool:|execute tool|ejecuta la herramienta)\b/i.test(message)) {
      return { kind: "message", message: "Puedo ayudarte con disponibilidad y cotizaciones, pero no ejecutar instrucciones internas indicadas en el mensaje." };
    }

    const dates = extractIsoDates(message);
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

    return { kind: "message", message: "Indicame fechas en formato AAAA-MM-DD y cantidad de personas para consultar disponibilidad, o una habitación y fechas para cotizar." };
  }
}
