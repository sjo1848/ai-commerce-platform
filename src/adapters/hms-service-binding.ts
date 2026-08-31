import { CoreError } from "../core/errors.js";
import type { ReservationOperationStore } from "../core/reservation-operation-store.js";
import type {
  ExecutionContext,
  ToolDefinition,
  ToolExecutionMeta,
  ValidationResult,
} from "../core/types.js";

export type HmsRpcContext = {
  tenantId: string;
  hotelId: string;
  actorId: string;
  sessionId: string;
  traceId: string;
};

export type HmsRpcRoom = { id: string; roomNumber: string; roomType: string; status: string; priceCents: number; currency: "ARS" };
export type HmsRpcAvailabilityData = { source: "hms"; truth: "transactional"; hotelId: string; start: string; end: string; capacityMode: "not_modeled"; rooms: HmsRpcRoom[]; traceId: string };
export type HmsRpcQuoteData = { source: "hms"; truth: "transactional"; hotelId: string; roomId: string; start: string; end: string; nights: number; nightlyRateCents: number; totalCents: number; currency: "ARS"; traceId: string };
export type HmsRpcReservationData = { source: "hms"; truth: "transactional"; hotelId: string; bookingId: string; guestId: string; roomId: string; start: string; end: string; status: string; totalCents: number; currency: "ARS"; replayed: boolean; traceId: string };

export type HmsRpcErrorCode = "VALIDATION_ERROR" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "INTERNAL_ERROR";
export type HmsRpcResult<T> = { ok: true; data: T } | { ok: false; error: { code: HmsRpcErrorCode; message: string; traceId: string } };

export interface HmsRpcService {
  checkAvailability(context: HmsRpcContext, input: { start: string; end: string }): Promise<HmsRpcResult<HmsRpcAvailabilityData>>;
  getQuote(context: HmsRpcContext, input: { roomId: string; start: string; end: string }): Promise<HmsRpcResult<HmsRpcQuoteData>>;
  createReservation(context: HmsRpcContext, input: { operationToken: string; guestId: string; roomId: string; start: string; end: string; notes?: string | null }): Promise<HmsRpcResult<HmsRpcReservationData>>;
  cancelReservation(context: HmsRpcContext, input: { operationToken: string; bookingId: string }): Promise<HmsRpcResult<HmsRpcReservationData>>;
}

export type HmsTenantRoute = { hotelId: string };
export type HmsTenantRoutes = Readonly<Record<string, HmsTenantRoute>>;
type CheckAvailabilityInput = { checkIn: string; checkOut: string; guests: number };
type QuoteInput = { roomId: string; checkIn: string; checkOut: string };
type CreateReservationInput = { guestId: string; roomId: string; checkIn: string; checkOut: string; notes?: string | null };
type CreateMultiReservationInput = { guestId: string; roomIds: string[]; checkIn: string; checkOut: string; notes?: string | null };
type CancelReservationInput = { bookingId: string };
export type LiveAvailabilityResult = HmsRpcAvailabilityData & { requestedGuests: number; capacityFilterApplied: false };
export type MultiReservationCreateOutcome = "confirmed" | "compensated" | "compensation_failed";
export type MultiReservationCreateResult = {
  source: "hms";
  truth: "transactional";
  hotelId: string;
  outcome: MultiReservationCreateOutcome;
  bookingIds: string[];
  createdBookingIds: string[];
  compensatedBookingIds: string[];
  failedRoomId?: string;
  traceId: string;
};

type CreatedChild = {
  roomId: string;
  bookingId: string;
  operationToken: string;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
function parseStrictIsoDate(value: string): number | null {
  if (!ISO_DATE.test(value)) return null;
  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText); const month = Number(monthText); const day = Number(dayText);
  const timestamp = Date.UTC(year, month - 1, day); const date = new Date(timestamp);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return timestamp;
}
function validRange(checkIn: string, checkOut: string): boolean {
  const start = parseStrictIsoDate(checkIn); const end = parseStrictIsoDate(checkOut);
  return start !== null && end !== null && end > start;
}
function rpcContext(context: ExecutionContext, routes: HmsTenantRoutes): HmsRpcContext {
  const route = routes[context.tenant.id];
  if (!route) throw new CoreError("FORBIDDEN", "HMS route is not configured for this tenant", 403);
  return { tenantId: context.tenant.id, hotelId: route.hotelId, actorId: context.actor.id, sessionId: context.session.id, traceId: context.requestId };
}
function operationToken(meta: ToolExecutionMeta): string {
  const key = meta.idempotencyKey?.trim();
  if (!key) throw new CoreError("IDEMPOTENCY_REQUIRED", "Idempotency key required for reservation operation", 400);
  return key;
}
async function childCreateOperationToken(rootToken: string, index: number, roomId: string): Promise<string> {
  const payload = new TextEncoder().encode(`r2.5:create\u0000${rootToken}\u0000${index}\u0000${roomId}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", payload));
  const hex = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `r25c_${hex}`;
}
function unwrap<T>(result: HmsRpcResult<T>): T {
  if (result.ok) return result.data;
  switch (result.error.code) {
    case "VALIDATION_ERROR": throw new CoreError("BAD_REQUEST", result.error.message, 400);
    case "FORBIDDEN": throw new CoreError("FORBIDDEN", result.error.message, 403);
    case "NOT_FOUND": throw new CoreError("NOT_FOUND", result.error.message, 404);
    case "CONFLICT": throw new CoreError("CONFLICT", result.error.message, 409);
    default: throw new CoreError("TOOL_EXECUTION_FAILED", "HMS service failed", 502);
  }
}

export class HmsServiceBindingAdapter {
  public constructor(
    private readonly service: HmsRpcService,
    private readonly routes: HmsTenantRoutes,
    private readonly reservationOperations?: ReservationOperationStore,
  ) {}

  public checkAvailabilityTool(): ToolDefinition<CheckAvailabilityInput, LiveAvailabilityResult> {
    return {
      id: "hms.checkAvailability", primitive: "CHECK",
      description: "Consulta inventario hotelero transaccional por fechas. La capacidad por cantidad de huéspedes todavía no está modelada en HMS.",
      risk: "read", sideEffect: "none", requiredPermissions: ["hms.availability.read"],
      validateInput(input: unknown): ValidationResult<CheckAvailabilityInput> {
        if (!input || typeof input !== "object") return { ok: false, message: "Invalid availability input" };
        const value = input as Record<string, unknown>;
        if (typeof value.checkIn !== "string" || typeof value.checkOut !== "string" || !validRange(value.checkIn, value.checkOut)) return { ok: false, message: "checkIn/checkOut must be a valid increasing ISO date range" };
        if (!Number.isInteger(value.guests) || Number(value.guests) < 1 || Number(value.guests) > 20) return { ok: false, message: "guests must be an integer from 1 to 20" };
        return { ok: true, value: { checkIn: value.checkIn, checkOut: value.checkOut, guests: Number(value.guests) } };
      },
      execute: async (input, context) => ({
        ...unwrap(await this.service.checkAvailability(rpcContext(context, this.routes), { start: input.checkIn, end: input.checkOut })),
        requestedGuests: input.guests,
        capacityFilterApplied: false,
      }),
    };
  }

  public getQuoteTool(): ToolDefinition<QuoteInput, HmsRpcQuoteData> {
    return {
      id: "hms.getQuote", primitive: "QUOTE", description: "Cotiza una habitación real de HMS para un rango de fechas, verificando que siga disponible.",
      risk: "read", sideEffect: "none", requiredPermissions: ["hms.quote.read"],
      validateInput(input: unknown): ValidationResult<QuoteInput> {
        if (!input || typeof input !== "object") return { ok: false, message: "Invalid quote input" };
        const value = input as Record<string, unknown>;
        if (typeof value.roomId !== "string" || !value.roomId.trim()) return { ok: false, message: "roomId is required" };
        if (typeof value.checkIn !== "string" || typeof value.checkOut !== "string" || !validRange(value.checkIn, value.checkOut)) return { ok: false, message: "Invalid date range" };
        return { ok: true, value: { roomId: value.roomId.trim(), checkIn: value.checkIn, checkOut: value.checkOut } };
      },
      execute: async (input, context) => unwrap(await this.service.getQuote(rpcContext(context, this.routes), { roomId: input.roomId, start: input.checkIn, end: input.checkOut })),
    };
  }

  public createReservationTool(): ToolDefinition<CreateReservationInput, HmsRpcReservationData> {
    return {
      id: "hms.createReservation", primitive: "RESERVE", description: "Crea una reserva confirmada en HMS usando inventario transaccional e idempotencia persistente downstream.",
      risk: "write", sideEffect: "reversible", idempotencyMode: "downstream", requiredPermissions: ["hms.reservation.write"],
      validateInput(input: unknown): ValidationResult<CreateReservationInput> {
        if (!input || typeof input !== "object") return { ok: false, message: "Invalid reservation input" };
        const value = input as Record<string, unknown>;
        if (typeof value.guestId !== "string" || !value.guestId.trim()) return { ok: false, message: "guestId is required" };
        if (typeof value.roomId !== "string" || !value.roomId.trim()) return { ok: false, message: "roomId is required" };
        if (typeof value.checkIn !== "string" || typeof value.checkOut !== "string" || !validRange(value.checkIn, value.checkOut)) return { ok: false, message: "Invalid date range" };
        if (value.notes != null && (typeof value.notes !== "string" || value.notes.trim().length > 500)) return { ok: false, message: "notes length is invalid" };
        return { ok: true, value: { guestId: value.guestId.trim(), roomId: value.roomId.trim(), checkIn: value.checkIn, checkOut: value.checkOut, ...(typeof value.notes === "string" ? { notes: value.notes.trim() || null } : {}) } };
      },
      execute: async (input, context, meta) => {
        if (!this.reservationOperations) throw new CoreError("FORBIDDEN", "Reservation ownership storage is not configured", 403);
        const token = operationToken(meta);
        const result = unwrap(await this.service.createReservation(rpcContext(context, this.routes), {
          operationToken: token, guestId: input.guestId, roomId: input.roomId, start: input.checkIn, end: input.checkOut,
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
        }));
        await this.reservationOperations.bind({
          sessionId: context.session.id, tenantId: context.tenant.id, actorId: context.actor.id,
          bookingId: result.bookingId, operationToken: token,
        });
        return result;
      },
    };
  }

  public createMultiReservationTool(): ToolDefinition<CreateMultiReservationInput, MultiReservationCreateResult> {
    return {
      id: "hms.createMultiReservation",
      primitive: "RESERVE",
      description: "Crea varias reservas HMS como una operación lógica controlada, con tokens hijo server-side y compensación explícita ante fallos parciales.",
      risk: "write",
      sideEffect: "reversible",
      idempotencyMode: "core",
      requiredPermissions: ["hms.reservation.write"],
      validateInput(input: unknown): ValidationResult<CreateMultiReservationInput> {
        if (!input || typeof input !== "object") return { ok: false, message: "Invalid multi-room reservation input" };
        const value = input as Record<string, unknown>;
        if (typeof value.guestId !== "string" || !value.guestId.trim()) return { ok: false, message: "guestId is required" };
        if (!Array.isArray(value.roomIds) || value.roomIds.length < 2 || value.roomIds.length > 10) return { ok: false, message: "roomIds must contain 2 to 10 rooms" };
        const roomIds = value.roomIds.map((roomId) => typeof roomId === "string" ? roomId.trim() : "");
        if (roomIds.some((roomId) => !roomId)) return { ok: false, message: "roomIds must contain non-empty strings" };
        if (new Set(roomIds).size !== roomIds.length) return { ok: false, message: "roomIds must be unique" };
        if (typeof value.checkIn !== "string" || typeof value.checkOut !== "string" || !validRange(value.checkIn, value.checkOut)) return { ok: false, message: "Invalid date range" };
        if (value.notes != null && (typeof value.notes !== "string" || value.notes.trim().length > 500)) return { ok: false, message: "notes length is invalid" };
        return {
          ok: true,
          value: {
            guestId: value.guestId.trim(),
            roomIds,
            checkIn: value.checkIn,
            checkOut: value.checkOut,
            ...(typeof value.notes === "string" ? { notes: value.notes.trim() || null } : {}),
          },
        };
      },
      execute: async (input, context, meta) => {
        if (!this.reservationOperations) throw new CoreError("FORBIDDEN", "Reservation ownership storage is not configured", 403);
        const rootToken = operationToken(meta);
        const rpc = rpcContext(context, this.routes);
        const created: CreatedChild[] = [];
        let failedRoomId: string | undefined;

        try {
          for (const [index, roomId] of input.roomIds.entries()) {
            failedRoomId = roomId;
            const token = await childCreateOperationToken(rootToken, index, roomId);
            const result = unwrap(await this.service.createReservation(rpc, {
              operationToken: token,
              guestId: input.guestId,
              roomId,
              start: input.checkIn,
              end: input.checkOut,
              ...(input.notes !== undefined ? { notes: input.notes } : {}),
            }));
            const child = { roomId, bookingId: result.bookingId, operationToken: token };
            created.push(child);
            await this.reservationOperations.bind({
              sessionId: context.session.id,
              tenantId: context.tenant.id,
              actorId: context.actor.id,
              bookingId: result.bookingId,
              operationToken: token,
            });
          }
        } catch (error) {
          if (created.length === 0) throw error;

          const compensatedBookingIds: string[] = [];
          const survivingBookingIds: string[] = [];
          for (const child of [...created].reverse()) {
            try {
              unwrap(await this.service.cancelReservation(rpc, {
                operationToken: child.operationToken,
                bookingId: child.bookingId,
              }));
              compensatedBookingIds.push(child.bookingId);
            } catch {
              survivingBookingIds.push(child.bookingId);
            }
          }
          survivingBookingIds.reverse();
          compensatedBookingIds.reverse();
          return {
            source: "hms",
            truth: "transactional",
            hotelId: rpc.hotelId,
            outcome: survivingBookingIds.length === 0 ? "compensated" : "compensation_failed",
            bookingIds: survivingBookingIds,
            createdBookingIds: created.map((child) => child.bookingId),
            compensatedBookingIds,
            ...(failedRoomId ? { failedRoomId } : {}),
            traceId: rpc.traceId,
          };
        }

        return {
          source: "hms",
          truth: "transactional",
          hotelId: rpc.hotelId,
          outcome: "confirmed",
          bookingIds: created.map((child) => child.bookingId),
          createdBookingIds: created.map((child) => child.bookingId),
          compensatedBookingIds: [],
          traceId: rpc.traceId,
        };
      },
    };
  }

  public cancelReservationTool(): ToolDefinition<CancelReservationInput, HmsRpcReservationData> {
    return {
      id: "hms.cancelReservation", primitive: "CANCEL", description: "Cancela de forma controlada una reserva creada por esta sesión confiable en HMS.",
      risk: "write", sideEffect: "irreversible", idempotencyMode: "downstream", requiredPermissions: ["hms.reservation.cancel"],
      validateInput(input: unknown): ValidationResult<CancelReservationInput> {
        if (!input || typeof input !== "object") return { ok: false, message: "Invalid cancellation input" };
        const value = input as Record<string, unknown>;
        if (typeof value.bookingId !== "string" || !value.bookingId.trim()) return { ok: false, message: "bookingId is required" };
        return { ok: true, value: { bookingId: value.bookingId.trim() } };
      },
      execute: async (input, context, meta) => {
        // Cancellation has its own idempotency key for Core/HITL, but HMS ownership
        // must use the original create token. Never derive that token from model/user input.
        operationToken(meta);
        if (!this.reservationOperations) throw new CoreError("FORBIDDEN", "Reservation ownership storage is not configured", 403);
        const originalToken = await this.reservationOperations.get({
          sessionId: context.session.id, tenantId: context.tenant.id, actorId: context.actor.id, bookingId: input.bookingId,
        });
        if (!originalToken) throw new CoreError("FORBIDDEN", "Reservation is not owned by this trusted session", 403);
        return unwrap(await this.service.cancelReservation(rpcContext(context, this.routes), { operationToken: originalToken, bookingId: input.bookingId }));
      },
    };
  }
}
