// Endpoints for the guest booking web app (authenticated by the WhatsApp link token).
import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { AppError } from "../errors.js";
import { createBooking, getBookingForSession, GuestDetails, payTest, publicBooking } from "../services/booking.js";
import { getCatalog } from "../services/catalog.js";
import { priceSelection, publicQuote, Selection } from "../services/pricing.js";
import { requireGuest, type GuestRequest } from "./auth.js";

export const publicRoutes = Router();
publicRoutes.use(requireGuest);

const sessionOf = (req: GuestRequest) => req.session!;

/** Link info + this guest's bookings. */
publicRoutes.get("/session", async (req: GuestRequest, res) => {
  const s = sessionOf(req);
  const bookings = await prisma.booking.findMany({
    where: { sessionId: s.id, status: { not: "HOLDING" } },
    orderBy: { createdAt: "desc" },
  });
  res.json({
    phone: s.phone,
    name: s.name,
    expiresAt: s.expiresAt,
    expired: s.expired,
    testMode: config.PAYMENT_MODE === "test",
    botWhatsApp: config.BOT_WHATSAPP_NUMBER,
    holdMinutes: config.HOLD_MINUTES,
    bookings: bookings.map(publicBooking),
  });
});

/** Hotels, room types, meal plans and lookup lists for the form. */
publicRoutes.get("/catalog", async (_req, res) => {
  const c = await getCatalog();
  res.json({
    hotels: c.hotels.map((h) => ({
      hotelId: h.hotelId,
      hotelName: h.hotelName,
      hotelType: h.hotelType,
      bookableRooms: h.bookableRooms,
      maxRoomNights: h.maxRoomNights,
      maxBookingDays: h.maxBookingDays,
      roomTypes: h.roomTypes.map((r) => ({
        roomTypeId: r.roomTypeId,
        roomTypeName: r.roomTypeName,
        maximumPax: r.maximumPax,
        maxAdult: r.maxAdult,
        maxChildren: r.maxChildren,
        maxInfant: r.maxInfant,
      })),
    })),
    mealPlans: c.mealPlans,
    salutations: c.salutations,
    countries: c.countries,
  });
});

/** Live price including GST. */
publicRoutes.post("/quote", async (req: GuestRequest, res) => {
  if (sessionOf(req).expired) throw new AppError(401, "LINK_EXPIRED", "This booking link has expired. Please ask for a new link on WhatsApp.");
  const quote = await priceSelection(Selection.parse(req.body));
  res.json(publicQuote(quote));
});

/** Holds the rooms (PMS softbook). */
publicRoutes.post("/bookings", async (req: GuestRequest, res) => {
  const body = z.object({ selection: Selection, guest: GuestDetails, expectedTotal: z.number().positive() }).parse(req.body);
  const booking = await createBooking(sessionOf(req), body.selection, body.guest, body.expectedTotal);
  res.status(201).json(publicBooking(booking));
});

publicRoutes.get("/bookings/:id", async (req: GuestRequest, res) => {
  res.json(publicBooking(await getBookingForSession(sessionOf(req), String(req.params.id))));
});

/** Test payment -> confirmsoftbook. */
publicRoutes.post("/bookings/:id/pay-test", async (req: GuestRequest, res) => {
  res.json(publicBooking(await payTest(sessionOf(req), String(req.params.id))));
});
