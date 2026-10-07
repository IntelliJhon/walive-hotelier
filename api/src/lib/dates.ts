// Date-only helpers. The web app uses ISO dates (YYYY-MM-DD); the PMS uses DD-MM-YYYY.
// All arithmetic is done in UTC on date-only values, so time zones never shift a day.

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const PMS = /^(\d{2})-(\d{2})-(\d{4})$/;

export function parseIso(iso: string): Date {
  const m = ISO.exec(iso);
  if (!m) throw new Error(`Invalid date: ${iso}`);
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.toISOString().slice(0, 10) !== iso) throw new Error(`Invalid date: ${iso}`);
  return d;
}

export function parsePms(pms: string): Date {
  const m = PMS.exec(pms);
  if (!m) throw new Error(`Invalid PMS date: ${pms}`);
  return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
}

export const toIso = (d: Date) => d.toISOString().slice(0, 10);

export function toPms(d: Date): string {
  const [y, m, day] = toIso(d).split("-");
  return `${day}-${m}-${y}`;
}

export const isoToPms = (iso: string) => toPms(parseIso(iso));

export function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + days);
  return r;
}

export const diffDays = (from: Date, to: Date) => Math.round((to.getTime() - from.getTime()) / 86_400_000);

/** Nights of a stay: check-in up to (not including) check-out. */
export function nightsOf(checkinIso: string, checkoutIso: string): Date[] {
  const start = parseIso(checkinIso);
  const n = diffDays(start, parseIso(checkoutIso));
  return Array.from({ length: Math.max(n, 0) }, (_, i) => addDays(start, i));
}

/** Today's date in India (the hotels' local date). */
export function todayIst(): Date {
  return parseIso(new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10));
}

/** Local IST timestamp in the PMS payment format YYYY-MM-DDTHH:MM:SS. */
export function nowIstTimestamp(): string {
  return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 19);
}
