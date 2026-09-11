export type MutationGrounding =
  | { kind: "reservation"; checkIn: string; checkOut: string; roomIds: string[] }
  | { kind: "cancellation"; scope: "single"; bookingId: string }
  | { kind: "cancellation"; scope: "all" };

export type GroundingContext = {
  rooms?: readonly string[];
  bookings?: readonly string[];
  checkIn?: string;
  checkOut?: string;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const isCalendarDate = (value: unknown): value is string => {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const parts = value.split("-").map(Number);
  const year = parts[0]!;
  const month = parts[1]!;
  const day = parts[2]!;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};

export function validateMutationGrounding(value: unknown, context: GroundingContext): { ok: true; grounding: MutationGrounding } | { ok: false; reason: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, reason: "shape" };
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some((key) => !["kind", "checkIn", "checkOut", "roomIds", "scope", "bookingId"].includes(key))) return { ok: false, reason: "unknown_field" };
  if (v.kind === "reservation") {
    if (Object.keys(v).some((key) => !["kind", "checkIn", "checkOut", "roomIds"].includes(key))) return { ok: false, reason: "reservation_shape" };
    if (!isCalendarDate(v.checkIn) || !isCalendarDate(v.checkOut) || v.checkIn >= v.checkOut || context.checkIn !== v.checkIn || context.checkOut !== v.checkOut || !Array.isArray(v.roomIds) || v.roomIds.length < 1 || v.roomIds.length > 10 || v.roomIds.some((id) => typeof id !== "string" || id.length === 0 || id.trim() !== id) || new Set(v.roomIds).size !== v.roomIds.length) return { ok: false, reason: "reservation_shape" };
    if (!context.rooms || v.roomIds.some((id) => !context.rooms!.includes(id as string))) return { ok: false, reason: "unknown_room" };
    return { ok: true, grounding: { kind: "reservation", checkIn: v.checkIn, checkOut: v.checkOut, roomIds: [...v.roomIds] as string[] } };
  }
  if (v.kind === "cancellation" && v.scope === "all" && Object.keys(v).every((key) => ["kind", "scope"].includes(key)) && !!context.bookings?.length) return { ok: true, grounding: { kind: "cancellation", scope: "all" } };
  if (v.kind === "cancellation" && v.scope === "single" && typeof v.bookingId === "string" && v.bookingId.length > 0 && v.bookingId.trim() === v.bookingId && Object.keys(v).every((key) => ["kind", "scope", "bookingId"].includes(key)) && context.bookings?.includes(v.bookingId)) return { ok: true, grounding: { kind: "cancellation", scope: "single", bookingId: v.bookingId } };
  return { ok: false, reason: "cancellation_shape" };
}

export function createClarificationResult(message: string, missing: readonly string[]) {
  return { outcome: "clarification" as const, missing: [...missing], message };
}
