import { MIS, pms } from "../pms/client.js";
import type { MisItem, PmsHotel, PmsRoomType } from "../pms/types.js";

export interface Catalog {
  hotels: (PmsHotel & { roomTypes: PmsRoomType[] })[];
  mealPlans: MisItem[];
  salutations: MisItem[];
  countries: MisItem[];
  loadedAt: string;
}

// Hotel limits (bookableRooms, maxRoomNights, max guests...) can be changed in the PMS at any time,
// so the cached copy is kept short. Pricing re-checks with an even fresher copy.
const TTL_MS = 60 * 1000;
let cached: { at: number; data: Catalog } | undefined;
let loading: Promise<Catalog> | undefined;

async function load(): Promise<Catalog> {
  const [hotels, mealPlans, salutations, countries] = await Promise.all([
    pms.hotelDetails(),
    pms.mis(MIS.mealPlans),
    pms.mis(MIS.salutations),
    pms.mis(MIS.countries),
  ]);
  const withRooms = await Promise.all(
    hotels.map(async (h) => ({
      ...h,
      hotelName: h.hotelName.trim(),
      roomTypes: (await pms.roomTypes(h.hotelId)).sort((a, b) => a.order - b.order),
    })),
  );
  withRooms.sort((a, b) => a.order.localeCompare(b.order) || a.hotelName.localeCompare(b.hotelName));
  return {
    hotels: withRooms,
    mealPlans,
    salutations: salutations.filter((s) => s.name.trim()),
    countries,
    loadedAt: new Date().toISOString(),
  };
}

/** Hotels, room types and lookup lists, cached in memory. */
export async function getCatalog(opts: boolean | { maxAgeMs?: number } = false): Promise<Catalog> {
  const maxAge = opts === true ? 0 : typeof opts === "object" && opts.maxAgeMs !== undefined ? opts.maxAgeMs : TTL_MS;
  if (cached && Date.now() - cached.at < maxAge) return cached.data;
  loading ??= load()
    .then((data) => {
      cached = { at: Date.now(), data };
      return data;
    })
    .finally(() => {
      loading = undefined;
    });
  return loading;
}
