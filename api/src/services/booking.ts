import { randomBytes } from "node:crypto";
import { Prisma, type Booking } from "@prisma/client";
import { z } from "zod";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { AppError, PmsError } from "../errors.js";
import { nowIstTimestamp } from "../lib/dates.js";
import { pms } from "../pms/client.js";
import type { ConfirmTransaction, SoftBookGuest } from "../pms/types.js";
import { getCatalog } from "./catalog.js";
import { notifyGuest, rupees } from "./notify.js";
import { priceSelection, publicQuote, softBookHotels, type Quote, type Selection } from "./pricing.js";
import type { ResolvedSession } from "./sessions.js";

export const GuestDetails = z
  .object({
    title: z.string().max(10).default(""),
    firstName: z.string().trim().min(1, "First name is required").max(60),
    lastName: z.string().trim().min(1, "Last name is required").max(60),
    email: z.string().trim().email("Enter a valid email"),
    countryIso: z.string().trim().length(2, "Select a country"),
    address1: z.string().trim().min(3, "Address is required").max(150),
    address2: z.string().trim().max(150).default(""),
    pin: z.string().trim().min(3, "PIN code is required").max(10),
    instructions: z.string().trim().max(300).default(""),
  })
  .superRefine((g, ctx) => {
    if (g.countryIso.toUpperCase() === "IN" && !/^\d{6}$/.test(g.pin)) {
      ctx.addIssue({ code: "custom", path: ["pin"], message: "Indian PIN codes have 6 digits" });
    }
  });
export type GuestDetails = z.infer<typeof GuestDetails>;

async function event(bookingId: string, type: string, note?: string) {
  await prisma.bookingEvent.create({ data: { bookingId, type, note } });
}

function newReference() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(6);
  return "WB-" + Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

const dec = (n: number) => new Prisma.Decimal(n.toFixed(2));
const num = (d: Prisma.Decimal | null) => (d === null ? null : Number(d));

/** Booking as shown to the guest (no PMS internals). */
export function publicBooking(b: Booking) {
  return {
    id: b.id,
    reference: b.reference,
    status: b.status,
    quote: publicQuote(b.quote as unknown as Quote),
    totalValue: num(b.totalValue),
    totalTax: num(b.totalTax),
    totalAmount: num(b.totalAmount),
    softBookId: b.softBookId,
    confirmId: b.confirmId,
    holdExpiresAt: b.holdExpiresAt,
    failureReason: b.failureReason,
    createdAt: b.createdAt,
  };
}

/**
 * Re-prices the selection, then places a soft booking (room hold) on the PMS.
 * If the live price differs from what the guest saw, nothing is booked and the
 * new quote is returned so the guest can review it.
 */
export async function createBooking(session: ResolvedSession, selection: Selection, guest: GuestDetails, expectedTotal: number) {
  if (session.expired) throw new AppError(401, "LINK_EXPIRED", "This booking link has expired. Please ask for a new link on WhatsApp.");

  const quote = await priceSelection(selection);
  if (Math.abs(quote.amount - expectedTotal) > 0.5) {
    throw new AppError(409, "PRICE_CHANGED", "The price has changed since you last checked. Please review the new total.", {
      quote: publicQuote(quote),
    });
  }

  const catalog = await getCatalog();
  const countryIso = guest.countryIso.toUpperCase();
  const country = catalog.countries.find((c) => c.code === countryIso)?.name ?? countryIso;

  let booking = await prisma.booking.create({
    data: {
      reference: newReference(),
      sessionId: session.id,
      phone: session.phone,
      status: "HOLDING",
      guest: { ...guest, countryIso, country },
      quote: quote as unknown as Prisma.InputJsonValue,
      totalValue: dec(quote.value),
      totalTax: dec(quote.tax),
      totalAmount: dec(quote.amount),
    },
  });

  const guestDetails: SoftBookGuest = {
    title: guest.title,
    firstName: guest.firstName,
    lastName: guest.lastName,
    address1: guest.address1,
    address2: guest.address2,
    country,
    countryIso,
    pin: guest.pin,
    emailId: guest.email,
    phoneNumber: `+${session.phone}`,
    instructions: guest.instructions,
    pickUp: { mode: "", arrival: "", details: "" },
    hotels: softBookHotels(quote),
  };

  try {
    const sb = await pms.softBook(guestDetails, { bookingId: booking.id });
    booking = await prisma.booking.update({
      where: { id: booking.id },
      data: {
        status: "SOFT_BOOKED",
        softBookId: sb.softBookId,
        pmsTotal: dec(Number(sb.totalAmount)),
        holdExpiresAt: new Date(Date.now() + config.HOLD_MINUTES * 60_000),
      },
    });
    await event(booking.id, "SOFT_BOOKED", `softBookId ${sb.softBookId}, PMS total ${sb.totalAmount}`);
    if (Math.abs(Number(sb.totalAmount) - quote.amount) > 0.5) {
      await event(booking.id, "TOTAL_MISMATCH", `Our total ${quote.amount}, PMS total ${sb.totalAmount}`);
    }
    return booking;
  } catch (e) {
    const reason = e instanceof AppError ? e.message : "Unexpected error while holding the rooms.";
    await prisma.booking.update({ where: { id: booking.id }, data: { status: "SOFTBOOK_FAILED", failureReason: reason } });
    await event(booking.id, "SOFTBOOK_FAILED", reason);
    throw e;
  }
}

async function getOwnedBooking(session: ResolvedSession, bookingId: string) {
  const booking = await prisma.booking.findFirst({ where: { id: bookingId, sessionId: session.id } });
  if (!booking) throw new AppError(404, "NOT_FOUND", "Booking not found.");
  return booking;
}

export const getBookingForSession = getOwnedBooking;

/**
 * Test payment: records a synthetic transaction and confirms the booking.
 * Only available while PAYMENT_MODE=test (until SBI ePay is configured).
 */
export async function payTest(session: ResolvedSession, bookingId: string) {
  if (config.PAYMENT_MODE !== "test") throw new AppError(400, "PAYMENT_MODE", "Test payments are disabled.");
  const booking = await getOwnedBooking(session, bookingId);
  if (booking.status === "PAID") return confirmBooking(booking.id);
  if (booking.status !== "SOFT_BOOKED") return booking;
  if (booking.holdExpiresAt && booking.holdExpiresAt < new Date()) {
    await expireBooking(booking);
    throw new AppError(409, "HOLD_EXPIRED", "Your room hold has expired. Please start a new booking.");
  }

  {
    const amount = Number(booking.totalAmount);
    const txnRef = `TEST-${booking.softBookId}`;
    const transaction: ConfirmTransaction = {
      responseCode: "E000",
      transactionId: `TEST-TXN-${booking.softBookId}`,
      processingFeeAmount: 0,
      transactionAmount: amount,
      gst: 0,
      totalAmount: amount,
      transactionDate: nowIstTimestamp(),
      interchangeValue: "",
      tdr: "",
      paymentMode: "TEST",
      subMerchantId: "",
      referenceNo: txnRef,
      id: "",
      rs: "",
      tps: "Y",
      mandatoryFields: [],
      optionalFields: "",
      rsv: "",
      forexRate: "",
      forexAmount: "",
      currencyCode: "INR",
      merchantId: "",
      merchantOrderNo: txnRef,
      failureReason: "",
    };
    // Only one request can move SOFT_BOOKED -> PAID, so a double tap pays once.
    const moved = await prisma.booking.updateMany({ where: { id: booking.id, status: "SOFT_BOOKED" }, data: { status: "PAID" } });
    if (moved.count === 1) {
      await prisma.payment.create({
        data: {
          bookingId: booking.id,
          gateway: "TEST",
          transactionId: transaction.transactionId,
          amount: dec(amount),
          status: "SUCCESS",
          raw: transaction as unknown as Prisma.InputJsonValue,
        },
      });
      await event(booking.id, "PAID", `TEST transaction ${transaction.transactionId}`);
    }
  }
  return confirmBooking(booking.id);
}

/**
 * Sends confirmsoftbook for a paid booking. Safe to call repeatedly: only one
 * caller can move PAID/CONFIRM_FAILED -> CONFIRMING.
 */
export async function confirmBooking(bookingId: string) {
  const moved = await prisma.booking.updateMany({
    where: { id: bookingId, status: { in: ["PAID", "CONFIRM_FAILED"] } },
    data: { status: "CONFIRMING" },
  });
  if (moved.count === 0) return prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });

  const booking = await prisma.booking.findUniqueOrThrow({
    where: { id: bookingId },
    include: { payments: { where: { status: "SUCCESS" }, orderBy: { createdAt: "desc" }, take: 1 } },
  });
  const payment = booking.payments[0];
  const quote = booking.quote as unknown as Quote;

  try {
    if (!payment) throw new AppError(409, "NO_PAYMENT", "No successful payment found for this booking.");
    const res = await pms.confirmSoftBook(
      {
        // The PMS takes one hotelId here even for multi-hotel bookings; we send the first stay's hotel.
        hotelId: quote.stays[0].hotelId,
        softBookId: booking.softBookId!,
        transaction: payment.raw as unknown as ConfirmTransaction,
      },
      { bookingId },
    );
    const done = await prisma.booking.update({
      where: { id: bookingId },
      data: { status: "CONFIRMED", confirmId: res.confirmId, failureReason: null },
    });
    await event(bookingId, "CONFIRMED", `confirmId ${res.confirmId}`);
    await notifyGuest(done.phone, "booking_confirmed", confirmationText(done, quote), {
      reference: done.reference,
      confirmId: done.confirmId,
    });
    return done;
  } catch (e) {
    const reason = e instanceof AppError ? e.message : "Unexpected error while confirming.";
    const failed = await prisma.booking.update({ where: { id: bookingId }, data: { status: "CONFIRM_FAILED", failureReason: reason } });
    await event(bookingId, "CONFIRM_FAILED", reason);
    await notifyGuest(
      failed.phone,
      "confirm_failed",
      `We received your payment for booking ${failed.reference}, but the hotel has not confirmed it yet. Our team is checking and will update you shortly.`,
      { reference: failed.reference },
    );
    if (e instanceof PmsError || e instanceof AppError) return failed;
    throw e;
  }
}

async function expireBooking(b: Booking) {
  const moved = await prisma.booking.updateMany({ where: { id: b.id, status: "SOFT_BOOKED" }, data: { status: "HOLD_EXPIRED" } });
  if (moved.count === 0) return;
  await event(b.id, "HOLD_EXPIRED", `Hold expired at ${b.holdExpiresAt?.toISOString()}`);
  await notifyGuest(
    b.phone,
    "hold_expired",
    `Your room hold for booking ${b.reference} has expired because payment was not completed. Reply *book* to start a new booking.`,
    { reference: b.reference },
  );
}

/** Marks unpaid soft bookings past their hold time as expired. Run by the cron job. */
export async function expireHolds() {
  const due = await prisma.booking.findMany({ where: { status: "SOFT_BOOKED", holdExpiresAt: { lt: new Date() } } });
  for (const b of due) await expireBooking(b);
  return due.length;
}

const longDate = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
/** 2026-10-08 -> "Thu, 8 Oct 2026" */
function fmtDate(iso: string) {
  const p = Object.fromEntries(longDate.formatToParts(new Date(`${iso}T00:00:00Z`)).map((x) => [x.type, x.value]));
  return `${p.weekday}, ${p.day} ${p.month} ${p.year}`;
}

/** "14:00" -> "2:00 PM" */
function fmtTime(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

const titleCase = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
const DIVIDER = "━━━━━━━━━━━━━━━";

function guestsLabel(r: { adults: number; children: number; infants: number }) {
  return [plural(r.adults, "adult"), r.children ? plural(r.children, "child", "children") : "", r.infants ? plural(r.infants, "infant") : ""]
    .filter(Boolean)
    .join(", ");
}

/** WhatsApp confirmation (uses WhatsApp *bold* / _italic_ formatting). */
export function confirmationText(b: Booking, quote: Quote) {
  const guest = b.guest as { firstName?: string } | null;
  const first = guest?.firstName?.trim();

  const stays = quote.stays.flatMap((s) => {
    // Group identical rooms: "2 × Premium Suite (2 adults)"
    const groups = new Map<string, number>();
    for (const r of s.rooms) {
      const key = `${titleCase(r.roomTypeName)} (${guestsLabel(r)})`;
      groups.set(key, (groups.get(key) ?? 0) + 1);
    }
    return [
      `🏨 *${titleCase(s.hotelName)}*`,
      `📅 *Check-in:* ${fmtDate(s.checkin)} · ${fmtTime(config.CHECKIN_TIME)}`,
      `📅 *Check-out:* ${fmtDate(s.checkout)} · ${fmtTime(config.CHECKOUT_TIME)}`,
      `🌙 ${plural(s.nights, "night")}`,
      ...[...groups].map(([label, n]) => `🛏️ ${n} × ${label}`),
      `🍽️ ${titleCase(s.mealPlanName)}`,
      DIVIDER,
    ];
  });

  return [
    `✅ *Booking Confirmed!*`,
    ``,
    `Hi${first ? ` *${first}*` : ""}, your stay is booked 🎉`,
    DIVIDER,
    ...stays,
    `💳 *Payment summary*`,
    `Room & meals: ${rupees(Number(b.totalValue))}`,
    `GST: ${rupees(Number(b.totalTax))}`,
    `*Total paid: ${rupees(Number(b.totalAmount))}*`,
    DIVIDER,
    `🔖 *Confirmation no:* ${b.confirmId}`,
    `🧾 Booking ref: ${b.reference}`,
    ``,
    `_Please show the confirmation number at check-in._`,
    `Need help? Just reply to this chat 😊`,
  ].join("\n");
}

/** Short summary for the WhatsApp bot's "my booking" answer. */
export async function bookingsForPhone(phone: string) {
  const list = await prisma.booking.findMany({
    where: { phone, status: { notIn: ["HOLDING", "SOFTBOOK_FAILED"] } },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  return list.map((b) => {
    const q = b.quote as unknown as Quote;
    return {
      reference: b.reference,
      status: b.status,
      confirmId: b.confirmId,
      totalAmount: Number(b.totalAmount),
      stays: q.stays.map((s) => ({ hotelName: s.hotelName, checkin: s.checkin, checkout: s.checkout, rooms: s.rooms.length })),
      createdAt: b.createdAt,
    };
  });
}
