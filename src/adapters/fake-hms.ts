import type { ToolDefinition, ValidationResult } from "../core/types.js";

export type Room = {
  id: string;
  roomNumber: string;
  roomType: string;
  capacity: number;
  priceCents: number;
  currency: "ARS";
};

type Booking = { roomId: string; checkIn: string; checkOut: string };
type CheckAvailabilityInput = { checkIn: string; checkOut: string; guests: number };
type QuoteInput = { roomId: string; checkIn: string; checkOut: string };

type AvailabilityResult = {
  source: "fake-hms";
  truth: "transactional";
  checkIn: string;
  checkOut: string;
  guests: number;
  rooms: Room[];
};

type QuoteResult = {
  source: "fake-hms";
  roomId: string;
  nights: number;
  nightlyRateCents: number;
  totalCents: number;
  currency: "ARS";
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseStrictIsoDate(value: string): number | null {
  if (!ISO_DATE.test(value)) return null;
  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) return null;
  return timestamp;
}

function validRange(checkIn: string, checkOut: string): boolean {
  const start = parseStrictIsoDate(checkIn);
  const end = parseStrictIsoDate(checkOut);
  return start !== null && end !== null && end > start;
}

function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart < bEnd && aEnd > bStart;
}

function nights(checkIn: string, checkOut: string): number {
  return Math.round((Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / 86_400_000);
}

export class FakeHmsAdapter {
  private readonly rooms: Room[];
  private readonly bookings: Booking[];

  constructor(seed?: { rooms?: Room[]; bookings?: Booking[] }) {
    this.rooms = seed?.rooms ?? [
      { id: "room-101", roomNumber: "101", roomType: "Standard", capacity: 2, priceCents: 75_000, currency: "ARS" },
      { id: "room-102", roomNumber: "102", roomType: "Standard", capacity: 3, priceCents: 82_000, currency: "ARS" },
      { id: "room-201", roomNumber: "201", roomType: "Suite", capacity: 4, priceCents: 120_000, currency: "ARS" },
    ];
    this.bookings = seed?.bookings ?? [{ roomId: "room-101", checkIn: "2026-09-10", checkOut: "2026-09-12" }];
  }

  checkAvailabilityTool(): ToolDefinition<CheckAvailabilityInput, AvailabilityResult> {
    return {
      id: "hms.checkAvailability",
      primitive: "CHECK",
      description: "Consulta disponibilidad de habitaciones para un rango y cantidad de huéspedes.",
      risk: "read",
      sideEffect: "none",
      requiredPermissions: ["hms.availability.read"],
      validateInput(input: unknown): ValidationResult<CheckAvailabilityInput> {
        if (!input || typeof input !== "object") return { ok: false, message: "Invalid availability input" };
        const value = input as Record<string, unknown>;
        if (typeof value.checkIn !== "string" || typeof value.checkOut !== "string" || !validRange(value.checkIn, value.checkOut)) {
          return { ok: false, message: "checkIn/checkOut must be a valid increasing ISO date range" };
        }
        if (!Number.isInteger(value.guests) || Number(value.guests) < 1 || Number(value.guests) > 20) {
          return { ok: false, message: "guests must be an integer from 1 to 20" };
        }
        return { ok: true, value: { checkIn: value.checkIn, checkOut: value.checkOut, guests: Number(value.guests) } };
      },
      execute: async (input) => {
        const rooms = this.rooms.filter((room) => room.capacity >= input.guests && !this.bookings.some((booking) => booking.roomId === room.id && overlaps(input.checkIn, input.checkOut, booking.checkIn, booking.checkOut)));
        return { source: "fake-hms", truth: "transactional", ...input, rooms };
      },
    };
  }

  getQuoteTool(): ToolDefinition<QuoteInput, QuoteResult> {
    return {
      id: "hms.getQuote",
      primitive: "QUOTE",
      description: "Cotiza una habitación para un rango de fechas.",
      risk: "read",
      sideEffect: "none",
      requiredPermissions: ["hms.quote.read"],
      validateInput(input: unknown): ValidationResult<QuoteInput> {
        if (!input || typeof input !== "object") return { ok: false, message: "Invalid quote input" };
        const value = input as Record<string, unknown>;
        if (typeof value.roomId !== "string" || !value.roomId.trim()) return { ok: false, message: "roomId is required" };
        if (typeof value.checkIn !== "string" || typeof value.checkOut !== "string" || !validRange(value.checkIn, value.checkOut)) return { ok: false, message: "Invalid date range" };
        return { ok: true, value: { roomId: value.roomId, checkIn: value.checkIn, checkOut: value.checkOut } };
      },
      execute: async (input) => {
        const room = this.rooms.find((candidate) => candidate.id === input.roomId);
        if (!room) throw new Error("Room not found");
        const count = nights(input.checkIn, input.checkOut);
        return { source: "fake-hms", roomId: room.id, nights: count, nightlyRateCents: room.priceCents, totalCents: count * room.priceCents, currency: room.currency };
      },
    };
  }
}
