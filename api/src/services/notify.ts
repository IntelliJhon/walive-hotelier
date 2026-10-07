import { config } from "../config.js";

export type NotifyEvent = "booking_confirmed" | "confirm_failed" | "hold_expired";

/**
 * Asks n8n to send a WhatsApp message. Never throws: a failed notification must
 * not undo a booking. The text is composed here so n8n only has to deliver it.
 */
export async function notifyGuest(phone: string, event: NotifyEvent, text: string, data: Record<string, unknown> = {}) {
  if (!config.N8N_NOTIFY_URL) {
    console.info(`[notify skipped: N8N_NOTIFY_URL not set] ${event} -> ${phone}`);
    return false;
  }
  try {
    const res = await fetch(config.N8N_NOTIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-walive-secret": config.CHAT_API_SECRET },
      body: JSON.stringify({ phone, event, text, ...data }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) console.error(`n8n notify failed: HTTP ${res.status}`);
    return res.ok;
  } catch (e) {
    console.error("n8n notify failed", e);
    return false;
  }
}

const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 0 });
export const rupees = (n: number) => `₹${inr.format(n)}`;
