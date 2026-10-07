import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { config } from "../config.js";
import { AppError } from "../errors.js";
import { resolveSession, type ResolvedSession } from "../services/sessions.js";

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** n8n -> API: shared secret in the x-walive-secret header. */
export function requireChatSecret(req: Request, _res: Response, next: NextFunction) {
  const secret = req.header("x-walive-secret") ?? "";
  if (!safeEqual(secret, config.CHAT_API_SECRET)) throw new AppError(401, "UNAUTHORIZED", "Invalid secret.");
  next();
}

/** Admin dashboard: HTTP Basic auth with ADMIN_USER / ADMIN_PASSWORD. */
export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  const [scheme, encoded] = (req.header("authorization") ?? "").split(" ");
  const [user, ...rest] = scheme === "Basic" && encoded ? Buffer.from(encoded, "base64").toString().split(":") : [];
  const pass = rest.join(":");
  if (!user || !safeEqual(user, config.ADMIN_USER) || !safeEqual(pass, config.ADMIN_PASSWORD)) {
    throw new AppError(401, "UNAUTHORIZED", "Invalid admin credentials.");
  }
  next();
}

export interface GuestRequest extends Request {
  session?: ResolvedSession;
}

/** Guest web app: the link token from WhatsApp, sent as a Bearer token. */
export async function requireGuest(req: GuestRequest, _res: Response, next: NextFunction) {
  const [scheme, token] = (req.header("authorization") ?? "").split(" ");
  if (scheme !== "Bearer" || !token) throw new AppError(401, "INVALID_LINK", "Missing booking link token.");
  req.session = await resolveSession(token);
  next();
}
