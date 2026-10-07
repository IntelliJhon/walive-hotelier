import { describe, expect, it } from "vitest";
import { addDays, nightsOf, parseIso, toIso } from "../lib/dates.js";
import type { Catalog } from "./catalog.js";
import { minInventory, occupancyFor, validateSelection, type Selection } from "./pricing.js";

const today = parseIso("2026-10-07");
const iso = (days: number) => toIso(addDays(today, days));

const catalog: Catalog = {
  hotels: [
    {
      order: "",
      hotelId: "NH",
      hotelName: "DEMO HOTEL",
      hotelType: "",
      bookableRooms: 5,
      maxRoomNights: 5,
      maxPax: 4,
      maxAdult: 4,
      maxChildren: 2,
      maxInfant: 1,
      maxBookingDays: 365,
      totalRooms: 2,
      roomTypes: [
        { order: 1, roomTypeId: "02", roomTypeName: "PREMIUM SUITE", maximumPax: 4, maxAdult: 3, maxChildren: 1, maxInfant: 1, twinBed: 0, disabledAccess: 0, totalRooms: 21 },
      ],
    },
  ],
  mealPlans: [{ code: "CP", name: "CONTINENTAL PLAN" }],
  salutations: [],
  countries: [],
  loadedAt: "",
};

const sel = (over: Partial<Selection["stays"][number]> = {}): Selection => ({
  stays: [{ hotelId: "NH", checkin: iso(10), checkout: iso(12), mealPlan: "CP", rooms: [{ roomTypeId: "02", adults: 2, children: 0, infants: 0 }], ...over }],
});

describe("occupancyFor", () => {
  it("maps adults to single/double plus extra adults", () => {
    expect(occupancyFor({ roomTypeId: "02", adults: 1, children: 0, infants: 0 })).toMatchObject({ single: 1, double: 0, extraAdult: 0 });
    expect(occupancyFor({ roomTypeId: "02", adults: 2, children: 0, infants: 0 })).toMatchObject({ single: 0, double: 1, extraAdult: 0 });
    expect(occupancyFor({ roomTypeId: "02", adults: 3, children: 1, infants: 1 })).toEqual({
      single: 0, double: 1, extraAdult: 1, extraChild1: 1, extraChild2: 0, extraInfant: 1,
    });
  });
});

describe("validateSelection", () => {
  it("accepts a valid stay", () => {
    expect(() => validateSelection(sel(), catalog, today)).not.toThrow();
  });
  it("rejects past check-in", () => {
    expect(() => validateSelection(sel({ checkin: iso(-1), checkout: iso(1) }), catalog, today)).toThrow(/past/);
  });
  it("rejects zero nights and too many nights", () => {
    expect(() => validateSelection(sel({ checkin: iso(3), checkout: iso(3) }), catalog, today)).toThrow(/after check-in/);
    expect(() => validateSelection(sel({ checkin: iso(3), checkout: iso(9) }), catalog, today)).toThrow(/at most 5 nights/);
  });
  it("rejects too many guests for the room type", () => {
    expect(() => validateSelection(sel({ rooms: [{ roomTypeId: "02", adults: 4, children: 0, infants: 0 }] }), catalog, today)).toThrow(/3 adults/);
    expect(() => validateSelection(sel({ rooms: [{ roomTypeId: "02", adults: 3, children: 2, infants: 0 }] }), catalog, today)).toThrow(/children/);
  });
  it("rejects more rooms than the hotel allows per booking", () => {
    const rooms = Array.from({ length: 6 }, () => ({ roomTypeId: "02", adults: 1, children: 0, infants: 0 }));
    expect(() => validateSelection(sel({ rooms }), catalog, today)).toThrow(/at most 5 rooms/);
  });
  it("rejects unknown hotel, room type and meal plan", () => {
    expect(() => validateSelection(sel({ hotelId: "XX" }), catalog, today)).toThrow(/Unknown hotel/);
    expect(() => validateSelection(sel({ rooms: [{ roomTypeId: "99", adults: 1, children: 0, infants: 0 }] }), catalog, today)).toThrow(/Unknown room type/);
    expect(() => validateSelection(sel({ mealPlan: "ZZ" }), catalog, today)).toThrow(/meal plan/);
  });
});

describe("minInventory", () => {
  const nights = nightsOf("2026-12-07", "2026-12-11"); // 7, 8, 9, 10
  it("uses the lowest count across nights, from unordered bands", () => {
    const bands = [
      { fromDate: "10-12-2026", toDate: "25-12-2026", roomCount: 10 },
      { fromDate: "01-12-2026", toDate: "07-12-2026", roomCount: 10 },
      { fromDate: "08-12-2026", toDate: "09-12-2026", roomCount: 2 },
    ];
    expect(minInventory(bands, nights)).toBe(2);
  });
  it("treats nights with no band as unavailable", () => {
    expect(minInventory([{ fromDate: "07-12-2026", toDate: "08-12-2026", roomCount: 5 }], nights)).toBe(0);
  });
});

describe("dates", () => {
  it("lists nights excluding checkout", () => {
    expect(nightsOf("2026-10-30", "2026-11-02").map(toIso)).toEqual(["2026-10-30", "2026-10-31", "2026-11-01"]);
  });
});
