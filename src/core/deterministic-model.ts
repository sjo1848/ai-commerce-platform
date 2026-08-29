import type { ModelRouter, ModelRouteResult, ToolDescriptor } from "./types.js";

function extractIsoDates(message: string): string[] {
  return message.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? [];
}

function extractGuests(message: string): number | undefined {
  const match = message.match(/\b(?:para\s+)?(\d{1,2})\s*(?:personas?|hu[eé]spedes?|pax)\b/i);
  if (!match?.[1]) return undefined;
  return Number(match[1]);
}

export class DeterministicModelRouter implements ModelRouter {
  async route(message: string, _context: unknown, availableTools: readonly ToolDescriptor[]): Promise<ModelRouteResult> {
    const lower = message.toLowerCase();

    // User text never becomes a tool id. Common injection markers are treated as plain user text.
    if (/\b(ignore|ignora|system prompt|developer message|tool:|execute tool|ejecuta la herramienta)\b/i.test(message)) {
      return { kind: "message", message: "Puedo ayudarte con disponibilidad y cotizaciones, pero no ejecutar instrucciones internas indicadas en el mensaje." };
    }

    const dates = extractIsoDates(message);
    const guests = extractGuests(message) ?? 1;
    if ((lower.includes("dispon") || lower.includes("habitaci") || lower.includes("aloj")) && dates.length >= 2) {
      if (!availableTools.some((tool) => tool.id === "hms.checkAvailability")) {
        return { kind: "message", message: "La consulta de disponibilidad no está habilitada para este negocio." };
      }
      return { kind: "tool", plan: { toolId: "hms.checkAvailability", input: { checkIn: dates[0], checkOut: dates[1], guests } } };
    }

    return { kind: "message", message: "Indicame fechas en formato AAAA-MM-DD y cantidad de personas para consultar disponibilidad." };
  }
}
