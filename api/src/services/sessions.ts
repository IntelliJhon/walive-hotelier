import { createHash, randomBytes } from "node:crypto";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { AppError } from "../errors.js";

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

/** Normalises a WhatsApp number to digits with country code (e.g. 919876543210). */
export function normalisePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  return digits;
}

/** Creates a booking link for a WhatsApp guest. Only the token's hash is stored. */
export async function createSession(phone: string, name?: string) {
  // 96 random bits (16 chars) keeps the WhatsApp link short; links also expire after SESSION_MINUTES.
  const token = randomBytes(12).toString("base64url");
  const expiresAt = new Date(Date.now() + config.SESSION_MINUTES * 60_000);
  await prisma.chatSession.create({
    data: { phone: normalisePhone(phone), name: name?.trim() || null, tokenHash: hash(token), expiresAt },
  });
  return { link: `${config.WEB_BASE_URL.replace(/\/$/, "")}/b/${token}`, expiresAt };
}

/**
 * Resolves a link token. An expired link can still view its bookings (so a guest
 * can see a confirmation later) but cannot start new ones.
 */
export async function resolveSession(token: string) {
  const session = await prisma.chatSession.findUnique({ where: { tokenHash: hash(token) } });
  if (!session) throw new AppError(401, "INVALID_LINK", "This booking link is not valid. Please ask for a new link on WhatsApp.");
  return { ...session, expired: session.expiresAt < new Date() };
}

export type ResolvedSession = Awaited<ReturnType<typeof resolveSession>>;
