export type MutationGrounding =
  | { kind: "reservation"; checkIn: string; checkOut: string; roomIds: string[] }
  | { kind: "cancellation"; scope: "single"; bookingId: string }
  | { kind: "cancellation"; scope: "all" };

export type GroundingContext = { rooms?: readonly string[]; bookings?: readonly string[] };

export function validateMutationGrounding(value: unknown, context: GroundingContext): { ok: true; grounding: MutationGrounding } | { ok: false; reason: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, reason: "shape" };
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some((key) => !["kind", "checkIn", "checkOut", "roomIds", "scope", "bookingId"].includes(key))) return { ok: false, reason: "unknown_field" };
  if (v.kind === "reservation") {
    if (typeof v.checkIn !== "string" || typeof v.checkOut !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v.checkIn) || !/^\d{4}-\d{2}-\d{2}$/.test(v.checkOut) || !Array.isArray(v.roomIds) || v.roomIds.length < 1 || v.roomIds.some((id) => typeof id !== "string") || new Set(v.roomIds).size !== v.roomIds.length) return { ok: false, reason: "reservation_shape" };
    if (!context.rooms || v.roomIds.some((id) => !context.rooms!.includes(id as string))) return { ok: false, reason: "unknown_room" };
    return { ok: true, grounding: { kind: "reservation", checkIn: v.checkIn, checkOut: v.checkOut, roomIds: [...v.roomIds] as string[] } };
  }
  if (v.kind === "cancellation" && v.scope === "all" && Object.keys(v).every((key) => ["kind", "scope"].includes(key))) return { ok: true, grounding: { kind: "cancellation", scope: "all" } };
  if (v.kind === "cancellation" && v.scope === "single" && typeof v.bookingId === "string" && Object.keys(v).every((key) => ["kind", "scope", "bookingId"].includes(key)) && context.bookings?.includes(v.bookingId)) return { ok: true, grounding: { kind: "cancellation", scope: "single", bookingId: v.bookingId } };
  return { ok: false, reason: "cancellation_shape" };
}

export function createClarificationResult(message: string, missing: readonly string[]) {
  return { outcome: "clarification" as const, missing: [...missing], message };
}
