const BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: any,
    public issues?: { path: string; message: string }[],
  ) {
    super(message);
  }
}

export async function request<T>(path: string, init: RequestInit & { auth?: string } = {}): Promise<T> {
  const { auth, headers, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...rest,
      headers: { "Content-Type": "application/json", ...(auth ? { Authorization: auth } : {}), ...headers },
    });
  } catch {
    throw new ApiError(0, "NETWORK", "Can't reach the booking service. Check your connection and try again.");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.code ?? "ERROR", body.message ?? "Something went wrong.", body.details, body.issues);
  return body as T;
}

// ---- Types returned by the API ----

export interface MisItem {
  code: string;
  name: string;
}

export interface RoomTypeInfo {
  roomTypeId: string;
  roomTypeName: string;
  maximumPax: number;
  maxAdult: number;
  maxChildren: number;
  maxInfant: number;
}

export interface HotelInfo {
  hotelId: string;
  hotelName: string;
  hotelType: string;
  bookableRooms: number;
  maxRoomNights: number;
  maxBookingDays: number;
  roomTypes: RoomTypeInfo[];
}

export interface CatalogData {
  hotels: HotelInfo[];
  mealPlans: MisItem[];
  salutations: MisItem[];
  countries: MisItem[];
}

export interface RoomSel {
  roomTypeId: string;
  adults: number;
  children: number;
  infants: number;
}

export interface StaySel {
  hotelId: string;
  checkin: string;
  checkout: string;
  mealPlan: string;
  rooms: RoomSel[];
}

export interface Selection {
  stays: StaySel[];
}

export interface QuotedNight {
  date: string;
  value: number;
  tax: number;
  amount: number;
  /** Room / meal / extra-guest parts (absent on bookings made before this was added). */
  components?: { label: string; amount: number }[];
}

export interface QuotedRoom extends RoomSel {
  roomTypeName: string;
  nights: QuotedNight[];
  value: number;
  tax: number;
  amount: number;
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

export type BookingStatusCode =
  | "HOLDING"
  | "SOFTBOOK_FAILED"
  | "SOFT_BOOKED"
  | "PAID"
  | "CONFIRMING"
  | "CONFIRMED"
  | "CONFIRM_FAILED"
  | "HOLD_EXPIRED"
  | "PAYMENT_FAILED";

export interface Booking {
  id: string;
  reference: string;
  status: BookingStatusCode;
  quote: Quote;
  totalValue: number;
  totalTax: number;
  totalAmount: number;
  softBookId: string | null;
  confirmId: string | null;
  holdExpiresAt: string | null;
  failureReason: string | null;
  createdAt: string;
}

export interface SessionInfo {
  phone: string;
  name: string | null;
  expiresAt: string;
  expired: boolean;
  testMode: boolean;
  holdMinutes: number;
  bookings: Booking[];
}

export interface GuestForm {
  title: string;
  firstName: string;
  lastName: string;
  email: string;
  countryIso: string;
  address1: string;
  address2: string;
  pin: string;
  instructions: string;
}

/** Guest API bound to one WhatsApp link token. */
export function guestApi(token: string) {
  const auth = `Bearer ${token}`;
  return {
    session: () => request<SessionInfo>("/api/public/session", { auth }),
    catalog: () => request<CatalogData>("/api/public/catalog", { auth }),
    quote: (sel: Selection) => request<Quote>("/api/public/quote", { auth, method: "POST", body: JSON.stringify(sel) }),
    book: (selection: Selection, guest: GuestForm, expectedTotal: number) =>
      request<Booking>("/api/public/bookings", { auth, method: "POST", body: JSON.stringify({ selection, guest, expectedTotal }) }),
    booking: (id: string) => request<Booking>(`/api/public/bookings/${id}`, { auth }),
    payTest: (id: string) => request<Booking>(`/api/public/bookings/${id}/pay-test`, { auth, method: "POST" }),
  };
}
export type GuestApi = ReturnType<typeof guestApi>;
