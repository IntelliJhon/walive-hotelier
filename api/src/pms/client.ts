import { config } from "../config.js";
import { prisma } from "../db.js";
import { AppError, PmsError } from "../errors.js";
import type {
  CalcGstRoomTypeIn,
  ConfirmTransaction,
  InventoryBand,
  MisItem,
  PmsBaseResponse,
  PmsHotel,
  PmsRoomType,
  RateBand,
  SoftBookGuest,
  TaxedRateLine,
} from "./types.js";

/** MIS typeIds verified on the test server. */
export const MIS = {
  hotelTypes: "H6",
  mealPlans: "34",
  salutations: "A1",
  countries: "47",
  states: "60",
  cities: "31",
} as const;

interface CallOptions {
  bookingId?: string;
  /** Do not write this call to pms_calls (master-data refreshes). */
  skipLog?: boolean;
}

/**
 * Sends one action to the PMS. Every call is logged (without the API key),
 * and statuscode = 1 is raised as a PmsError carrying the PMS message.
 */
async function call<T extends PmsBaseResponse>(
  action: string,
  body: Record<string, unknown>,
  opts: CallOptions = {},
): Promise<T> {
  const request = { action, key: config.PMS_KEY, source: config.PMS_SOURCE, ...body };
  const logged = { ...request, key: "***" };
  const started = Date.now();
  let httpStatus: number | undefined;
  let json: T | undefined;
  let error: string | undefined;

  try {
    const res = await fetch(config.PMS_BASE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(config.PMS_TIMEOUT_MS),
    });
    httpStatus = res.status;
    const text = await res.text();
    try {
      json = JSON.parse(text) as T;
    } catch {
      error = `Non-JSON response (HTTP ${res.status}): ${text.slice(0, 200)}`;
    }
  } catch (e) {
    error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  }

  if (!opts.skipLog || error || json?.statuscode !== 0) {
    await prisma.pmsCall
      .create({
        data: {
          bookingId: opts.bookingId,
          action,
          request: logged,
          response: json as object | undefined,
          httpStatus,
          statuscode: json?.statuscode,
          message: json?.message || undefined,
          error,
          durationMs: Date.now() - started,
        },
      })
      .catch((e) => console.error("Failed to log PMS call", e));
  }

  if (error || !json) {
    throw new AppError(502, "PMS_UNAVAILABLE", "The hotel system is not responding right now. Please try again in a moment.", error);
  }
  if (json.statuscode !== 0) throw new PmsError(action, json.message);
  return json;
}

const group = () => ({ groupId: config.PMS_GROUP_ID });

export const pms = {
  async mis(typeId: string) {
    const r = await call<PmsBaseResponse & { mis: MisItem[] }>("mis", { ...group(), typeId }, { skipLog: true });
    return r.mis ?? [];
  },

  async hotelDetails() {
    const r = await call<PmsBaseResponse & { hotelList: PmsHotel[] }>("hoteldetails", { ...group(), hotelType: "" }, { skipLog: true });
    return r.hotelList ?? [];
  },

  async roomTypes(hotelId: string) {
    // The PMS expects lowercase "groupid" on this action only.
    const r = await call<PmsBaseResponse & { roomTypes: PmsRoomType[] }>(
      "roomtypesdetails",
      { groupid: config.PMS_GROUP_ID, hotelId },
      { skipLog: true },
    );
    return r.roomTypes ?? [];
  },

  async getRate(p: { hotelId: string; roomTypeId: string; fromDate: string; toDate: string; mealPlan: string }, opts?: CallOptions) {
    const r = await call<PmsBaseResponse & { ratePlanId: string; rates: RateBand[] }>(
      "getrate",
      { ...group(), ...p, rateType: config.PMS_RATE_TYPE },
      opts,
    );
    return r.rates ?? [];
  },

  async getInventory(p: { hotelId: string; roomTypeId: string; fromDate: string; toDate: string }, opts?: CallOptions) {
    const r = await call<PmsBaseResponse & { inventory: InventoryBand[] }>("getinventory", { ...group(), ...p }, opts);
    return r.inventory ?? [];
  },

  /** Returns one taxed line per night for each roomTypes[] entry, in the same order. */
  async calcGst(hotelId: string, roomTypes: CalcGstRoomTypeIn[], opts?: CallOptions) {
    const r = await call<PmsBaseResponse & { roomtypes: { roomTypeId: string; rates: TaxedRateLine[] }[] }>(
      "calcgst",
      { ...group(), hotelId, roomTypes },
      opts,
    );
    return r.roomtypes ?? [];
  },

  async softBook(guestDetails: SoftBookGuest, opts?: CallOptions) {
    const r = await call<PmsBaseResponse & { softbook: { softBookId: string; totalAmount: number } }>(
      "softbook",
      { ...group(), guestDetails },
      opts,
    );
    if (!r.softbook?.softBookId) throw new PmsError("softbook", r.message || "The hotel system did not return a booking id.");
    return r.softbook;
  },

  async confirmSoftBook(p: { hotelId: string; softBookId: string; transaction: ConfirmTransaction }, opts?: CallOptions) {
    const r = await call<
      PmsBaseResponse & { confirmSoftBook: { softBookId: string; confirmId: string; transactionId: string; transactionDate: string } }
    >("confirmsoftbook", { ...group(), ...p }, opts);
    if (!r.confirmSoftBook?.confirmId) throw new PmsError("confirmsoftbook", r.message || "The hotel system did not return a confirmation id.");
    return r.confirmSoftBook;
  },
};
