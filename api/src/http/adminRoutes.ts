// Admin dashboard endpoints (HTTP Basic auth).
import type { BookingStatus } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { AppError } from "../errors.js";
import { confirmBooking, expireHolds } from "../services/booking.js";
import { getCatalog } from "../services/catalog.js";
import { requireAdmin } from "./auth.js";

export const adminRoutes = Router();
adminRoutes.use(requireAdmin);

const num = (d: unknown) => (d === null || d === undefined ? null : Number(d));

adminRoutes.get("/bookings", async (req, res) => {
  const q = z.object({ status: z.string().optional(), search: z.string().optional() }).parse(req.query);
  const search = q.search?.trim();
  const list = await prisma.booking.findMany({
    where: {
      ...(q.status ? { status: q.status as BookingStatus } : {}),
      ...(search
        ? {
            OR: [
              { reference: { contains: search, mode: "insensitive" } },
              { phone: { contains: search } },
              { softBookId: { contains: search } },
              { confirmId: { contains: search } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  res.json(
    list.map((b) => ({
      id: b.id,
      reference: b.reference,
      phone: b.phone,
      status: b.status,
      guest: b.guest,
      totalAmount: num(b.totalAmount),
      pmsTotal: num(b.pmsTotal),
      softBookId: b.softBookId,
      confirmId: b.confirmId,
      failureReason: b.failureReason,
      createdAt: b.createdAt,
    })),
  );
});

adminRoutes.get("/bookings/:id", async (req, res) => {
  const b = await prisma.booking.findUnique({
    where: { id: String(req.params.id) },
    include: {
      payments: { orderBy: { createdAt: "asc" } },
      events: { orderBy: { createdAt: "asc" } },
      pmsCalls: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!b) throw new AppError(404, "NOT_FOUND", "Booking not found.");
  res.json({
    ...b,
    totalValue: num(b.totalValue),
    totalTax: num(b.totalTax),
    totalAmount: num(b.totalAmount),
    pmsTotal: num(b.pmsTotal),
    payments: b.payments.map((p) => ({ ...p, amount: num(p.amount) })),
  });
});

adminRoutes.post("/bookings/:id/retry-confirm", async (req, res) => {
  const b = await prisma.booking.findUnique({ where: { id: String(req.params.id) } });
  if (!b) throw new AppError(404, "NOT_FOUND", "Booking not found.");
  if (b.status !== "CONFIRM_FAILED" && b.status !== "PAID") {
    throw new AppError(409, "NOT_RETRYABLE", `Only paid bookings that failed to confirm can be retried (status is ${b.status}).`);
  }
  const done = await confirmBooking(b.id);
  res.json({ status: done.status, confirmId: done.confirmId, failureReason: done.failureReason });
});

/** Recent PMS calls (including failed master-data refreshes not tied to a booking). */
adminRoutes.get("/pms-calls", async (req, res) => {
  const q = z.object({ action: z.string().optional(), errorsOnly: z.string().optional() }).parse(req.query);
  const calls = await prisma.pmsCall.findMany({
    where: {
      ...(q.action ? { action: q.action } : {}),
      ...(q.errorsOnly === "1" ? { OR: [{ statuscode: { not: 0 } }, { error: { not: null } }] } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  res.json(calls);
});

adminRoutes.post("/catalog/refresh", async (_req, res) => {
  const c = await getCatalog(true);
  res.json({ hotels: c.hotels.length, loadedAt: c.loadedAt });
});

adminRoutes.post("/expire-holds", async (_req, res) => {
  res.json({ expired: await expireHolds() });
});
