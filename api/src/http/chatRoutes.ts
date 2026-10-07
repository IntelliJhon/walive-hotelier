// Endpoints called by the n8n WhatsApp workflow.
import { Router } from "express";
import { z } from "zod";
import { bookingsForPhone } from "../services/booking.js";
import { getCatalog } from "../services/catalog.js";
import { createSession, normalisePhone } from "../services/sessions.js";
import { requireChatSecret } from "./auth.js";

export const chatRoutes = Router();
chatRoutes.use(requireChatSecret);

/** Creates a booking link for the guest who asked to book. */
chatRoutes.post("/sessions", async (req, res) => {
  const body = z.object({ phone: z.string().min(8), name: z.string().optional() }).parse(req.body);
  res.json(await createSession(body.phone, body.name));
});

/** The guest's recent bookings, for "my booking" questions. */
chatRoutes.get("/bookings", async (req, res) => {
  const phone = normalisePhone(z.string().min(8).parse(req.query.phone));
  res.json({ bookings: await bookingsForPhone(phone) });
});

/** Hotels and room types as plain text for the AI agent's prompt. */
chatRoutes.get("/context", async (_req, res) => {
  const c = await getCatalog();
  const lines = c.hotels.map((h) => {
    const rooms = h.roomTypes
      .map((r) => `   - ${r.roomTypeName} (up to ${r.maximumPax} guests: ${r.maxAdult} adults, ${r.maxChildren} children)`)
      .join("\n");
    return `• ${h.hotelName}${h.hotelType ? ` (${h.hotelType})` : ""}\n${rooms}`;
  });
  const text = [
    "HOTELS",
    ...lines,
    "",
    `MEAL PLANS: ${c.mealPlans.map((m) => `${m.code} = ${m.name}`).join(", ")}`,
    `BOOKING LIMITS: up to ${Math.max(...c.hotels.map((h) => h.maxRoomNights || 0))} nights and ${Math.max(...c.hotels.map((h) => h.bookableRooms || 0))} rooms per hotel per booking.`,
  ].join("\n");
  res.json({ text, hotels: c.hotels.map((h) => ({ hotelId: h.hotelId, hotelName: h.hotelName })) });
});
