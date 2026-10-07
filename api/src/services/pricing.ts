import { z } from "zod";
import { config } from "../config.js";
import { AppError } from "../errors.js";
import { addDays, diffDays, isoToPms, nightsOf, parseIso, parsePms, toIso, toPms, todayIst } from "../lib/dates.js";
import { pms } from "../pms/client.js";
import type { CalcGstRoomTypeIn, Occupancy, RateBand, RateComponents, SoftBookHotel, TaxedRateLine } from "../pms/types.js";
import { getCatalog, type Catalog } from "./catalog.js";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const RoomSelection = z.object({
  roomTypeId: z.string().min(1),
  adults: z.number().int().min(1).max(10),
  children: z.number().int().min(0).max(10).default(0),
  infants: z.number().int().min(0).max(10).default(0),
});

export const StaySelection = z.object({
  hotelId: z.string().min(1),
  checkin: isoDate,
  checkout: isoDate,
  mealPlan: z.string().min(1),
  rooms: z.array(RoomSelection).min(1).max(20),
});

/** What the guest picks in the web app. One stay per hotel visit. */
export const Selection = z.object({
  stays: z.array(StaySelection).min(1).max(5),
});

export type RoomSelection = z.infer<typeof RoomSelection>;
export type StaySelection = z.infer<typeof StaySelection>;
export type Selection = z.infer<typeof Selection>;

export interface QuotedNight {
  date: string; // ISO
  value: number;
  tax: number;
  amount: number;
}

export interface QuotedRoom extends RoomSelection {
  roomTypeName: string;
  occupancy: Occupancy;
  nights: QuotedNight[];
  value: number;
  tax: number;
  amount: number;
  /** calcgst lines + mealPlan, exactly as softbook needs them. */
  pmsRates: (TaxedRateLine & { mealPlan: string })[];
}

export interface QuotedStay {
  hotelId: string;
  hotelName: string;
  checkin: string;
  checkout: string;
  nights: number;
  mealPlan: string;
  mealPlanName: string;
  rooms: QuotedRoom[];
  value: number;
  tax: number;
  amount: number;
}

export interface Quote {
  stays: QuotedStay[];
  value: number;
  tax: number;
  amount: number;
  currency: "INR";
  pricedAt: string;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;
const sum = (xs: number[]) => round2(xs.reduce((a, b) => a + b, 0));

/**
 * Maps one physical room to PMS charges. Verified on the test server:
 * 1 adult = single, 2+ adults = double, each adult beyond 2 = extraAdult,
 * each child = extraChild1, each infant = extraInfant (no charge).
 * Every room is sent as its own roomTypes[] entry because calcgst prices one room
 * and picks the GST slab from that room's own nightly total.
 */
export function occupancyFor(room: RoomSelection): Occupancy {
  return {
    single: room.adults === 1 ? 1 : 0,
    double: room.adults >= 2 ? 1 : 0,
    extraAdult: Math.max(room.adults - 2, 0),
    extraChild1: room.children,
    extraChild2: 0,
    extraInfant: room.infants,
  };
}

/** Checks the selection against hotel and room-type limits from the PMS. */
export function validateSelection(sel: Selection, catalog: Catalog, today: Date = todayIst()): void {
  const fail = (msg: string) => {
    throw new AppError(400, "INVALID_SELECTION", msg);
  };
  sel.stays.forEach((stay, si) => {
    const label = sel.stays.length > 1 ? `Stay ${si + 1}: ` : "";
    const hotel = catalog.hotels.find((h) => h.hotelId === stay.hotelId);
    if (!hotel) return fail(`${label}Unknown hotel.`);
    let checkin: Date, checkout: Date;
    try {
      checkin = parseIso(stay.checkin);
      checkout = parseIso(stay.checkout);
    } catch {
      return fail(`${label}Invalid dates.`);
    }
    const nights = diffDays(checkin, checkout);
    if (checkin < today) fail(`${label}Check-in cannot be in the past.`);
    if (nights < 1) fail(`${label}Check-out must be after check-in.`);
    if (hotel.maxRoomNights && nights > hotel.maxRoomNights)
      fail(`${label}${hotel.hotelName} allows at most ${hotel.maxRoomNights} nights per booking.`);
    if (hotel.maxBookingDays && checkin > addDays(today, hotel.maxBookingDays))
      fail(`${label}${hotel.hotelName} takes bookings up to ${hotel.maxBookingDays} days ahead.`);
    if (hotel.bookableRooms && stay.rooms.length > hotel.bookableRooms)
      fail(`${label}${hotel.hotelName} allows at most ${hotel.bookableRooms} rooms per booking.`);
    if (!catalog.mealPlans.some((m) => m.code === stay.mealPlan)) fail(`${label}Unknown meal plan.`);

    stay.rooms.forEach((room, ri) => {
      const rl = `${label}Room ${ri + 1}: `;
      const rt = hotel.roomTypes.find((r) => r.roomTypeId === room.roomTypeId);
      if (!rt) return fail(`${rl}Unknown room type.`);
      if (rt.maxAdult && room.adults > rt.maxAdult) fail(`${rl}${rt.roomTypeName} allows at most ${rt.maxAdult} adults.`);
      if (room.children > rt.maxChildren) fail(`${rl}${rt.roomTypeName} allows at most ${rt.maxChildren} children.`);
      if (room.infants > rt.maxInfant) fail(`${rl}${rt.roomTypeName} allows at most ${rt.maxInfant} infants.`);
      if (rt.maximumPax && room.adults + room.children > rt.maximumPax)
        fail(`${rl}${rt.roomTypeName} allows at most ${rt.maximumPax} guests (adults + children).`);
    });
  });
}

/** Picks the rate band that covers a night. */
function rateFor(bands: RateBand[], night: Date): RateComponents | undefined {
  return bands.find((b) => parsePms(b.fromDate) <= night && night <= parsePms(b.toDate))?.roomRate;
}

/** Lowest room count across the nights; a night not covered by any band counts as 0. */
export function minInventory(bands: { fromDate: string; toDate: string; roomCount: number }[], nights: Date[]): number {
  return Math.min(
    ...nights.map((n) => {
      const counts = bands.filter((b) => parsePms(b.fromDate) <= n && n <= parsePms(b.toDate)).map((b) => b.roomCount);
      return counts.length ? Math.min(...counts) : 0;
    }),
  );
}

async function priceStay(stay: StaySelection, catalog: Catalog, bookingId?: string): Promise<QuotedStay> {
  const hotel = catalog.hotels.find((h) => h.hotelId === stay.hotelId)!;
  const nights = nightsOf(stay.checkin, stay.checkout);
  const fromDate = toPms(nights[0]);
  const lastNight = toPms(nights[nights.length - 1]);
  const roomTypeIds = [...new Set(stay.rooms.map((r) => r.roomTypeId))];
  const opts = { bookingId };

  // Rates and availability for each room type in this stay.
  const perType = new Map<string, RateBand[]>();
  await Promise.all(
    roomTypeIds.map(async (roomTypeId) => {
      const [bands, inventory] = await Promise.all([
        pms.getRate({ hotelId: hotel.hotelId, roomTypeId, fromDate, toDate: lastNight, mealPlan: stay.mealPlan }, opts),
        pms.getInventory({ hotelId: hotel.hotelId, roomTypeId, fromDate, toDate: lastNight }, opts),
      ]);
      const name = hotel.roomTypes.find((r) => r.roomTypeId === roomTypeId)!.roomTypeName;
      const wanted = stay.rooms.filter((r) => r.roomTypeId === roomTypeId).length;
      const available = minInventory(inventory, nights);
      if (available < wanted) {
        throw new AppError(
          409,
          "NOT_AVAILABLE",
          available > 0
            ? `Only ${available} ${name} room(s) are available at ${hotel.hotelName} for these dates.`
            : `${name} is not available at ${hotel.hotelName} for these dates.`,
        );
      }
      perType.set(roomTypeId, bands);
    }),
  );

  // One calcgst entry per physical room (see occupancyFor).
  const entries: CalcGstRoomTypeIn[] = stay.rooms.map((room) => {
    const bands = perType.get(room.roomTypeId)!;
    return {
      roomTypeId: room.roomTypeId,
      ...occupancyFor(room),
      rates: nights.map((night) => {
        const rate = rateFor(bands, night);
        if (!rate) {
          const name = hotel.roomTypes.find((r) => r.roomTypeId === room.roomTypeId)!.roomTypeName;
          throw new AppError(409, "NO_RATE", `No rate is set for ${name} at ${hotel.hotelName} on ${toPms(night)}.`);
        }
        return { date: toPms(night), ...rate };
      }),
    };
  });

  const taxed = await pms.calcGst(hotel.hotelId, entries, opts);
  if (taxed.length !== entries.length) {
    throw new AppError(502, "PMS_GST_MISMATCH", "The hotel system returned an unexpected tax calculation. Please try again.");
  }

  const mealPlanName = catalog.mealPlans.find((m) => m.code === stay.mealPlan)?.name ?? stay.mealPlan;
  const rooms: QuotedRoom[] = stay.rooms.map((room, i) => {
    const lines = taxed[i].rates;
    if (taxed[i].roomTypeId !== room.roomTypeId || lines.length !== nights.length) {
      throw new AppError(502, "PMS_GST_MISMATCH", "The hotel system returned an unexpected tax calculation. Please try again.");
    }
    const pmsRates = lines.map((l) => ({ ...l, mealPlan: stay.mealPlan }));
    return {
      ...room,
      roomTypeName: hotel.roomTypes.find((r) => r.roomTypeId === room.roomTypeId)!.roomTypeName,
      occupancy: occupancyFor(room),
      nights: lines.map((l) => ({ date: toIso(parsePms(l.date)), value: l.value, tax: l.tax, amount: l.amount })),
      value: sum(lines.map((l) => l.value)),
      tax: sum(lines.map((l) => l.tax)),
      amount: sum(lines.map((l) => l.amount)),
      pmsRates,
    };
  });

  return {
    hotelId: hotel.hotelId,
    hotelName: hotel.hotelName,
    checkin: stay.checkin,
    checkout: stay.checkout,
    nights: nights.length,
    mealPlan: stay.mealPlan,
    mealPlanName,
    rooms,
    value: sum(rooms.map((r) => r.value)),
    tax: sum(rooms.map((r) => r.tax)),
    amount: sum(rooms.map((r) => r.amount)),
  };
}

/** Prices a selection live from the PMS (rates, availability and GST). */
export async function priceSelection(sel: Selection, bookingId?: string): Promise<Quote> {
  const catalog = await getCatalog();
  validateSelection(sel, catalog);
  const stays = await Promise.all(sel.stays.map((s) => priceStay(s, catalog, bookingId)));
  return {
    stays,
    value: sum(stays.map((s) => s.value)),
    tax: sum(stays.map((s) => s.tax)),
    amount: sum(stays.map((s) => s.amount)),
    currency: "INR",
    pricedAt: new Date().toISOString(),
  };
}

/** Builds softbook hotels[] from a quote. */
export function softBookHotels(quote: Quote): SoftBookHotel[] {
  return quote.stays.map((stay) => ({
    hotelId: stay.hotelId,
    checkinDate: isoToPms(stay.checkin),
    checkinTime: config.CHECKIN_TIME,
    checkoutDate: isoToPms(stay.checkout),
    checkoutTime: config.CHECKOUT_TIME,
    totalPax: stay.rooms.reduce((n, r) => n + r.adults + r.children, 0),
    totalAmount: stay.amount.toFixed(2),
    roomTypes: stay.rooms.map((room) => ({
      roomTypeId: room.roomTypeId,
      ...room.occupancy,
      twin: 0,
      rates: room.pmsRates,
    })),
  }));
}

/** Strips PMS-only fields before sending a quote to the browser. */
export function publicQuote(q: Quote) {
  return {
    ...q,
    stays: q.stays.map((s) => ({ ...s, rooms: s.rooms.map(({ pmsRates: _p, occupancy: _o, ...r }) => r) })),
  };
}
