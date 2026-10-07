const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2, minimumFractionDigits: 0 });
export const money = (n: number) => inr.format(n);

const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
export const fmtDate = (iso: string) => dateFmt.format(new Date(`${iso}T00:00:00Z`));

/** Today's date (local) as YYYY-MM-DD. */
export function todayIso(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const nightsBetween = (a: string, b: string) =>
  Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000);

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function guestsLabel(r: { adults: number; children: number; infants: number }) {
  return [plural(r.adults, "adult"), r.children ? plural(r.children, "child").replace("childs", "children") : "", r.infants ? plural(r.infants, "infant") : ""]
    .filter(Boolean)
    .join(", ");
}
