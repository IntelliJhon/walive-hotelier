import { useState, type FormEvent } from "react";
import type { CatalogData, GuestForm } from "../api";

interface Props {
  catalog: CatalogData;
  phone: string;
  initial: GuestForm;
  busy: boolean;
  serverErrors: Record<string, string>;
  submitLabel: string;
  onBack: () => void;
  onSubmit: (g: GuestForm) => void;
}

export const emptyGuest = (name?: string | null): GuestForm => {
  const [first = "", ...rest] = (name ?? "").trim().split(/\s+/);
  return { title: "", firstName: first, lastName: rest.join(" "), email: "", countryIso: "IN", address1: "", address2: "", pin: "", instructions: "" };
};

function validate(g: GuestForm): Record<string, string> {
  const e: Record<string, string> = {};
  if (!g.firstName.trim()) e.firstName = "First name is required";
  if (!g.lastName.trim()) e.lastName = "Last name is required";
  if (!/^\S+@\S+\.\S+$/.test(g.email.trim())) e.email = "Enter a valid email";
  if (!g.countryIso) e.countryIso = "Select a country";
  if (g.address1.trim().length < 3) e.address1 = "Address is required";
  if (!g.pin.trim()) e.pin = "PIN code is required";
  else if (g.countryIso === "IN" && !/^\d{6}$/.test(g.pin.trim())) e.pin = "Indian PIN codes have 6 digits";
  return e;
}

export function GuestFormView({ catalog, phone, initial, busy, serverErrors, submitLabel, onBack, onSubmit }: Props) {
  const [g, setG] = useState<GuestForm>(initial);
  const [touched, setTouched] = useState(false);
  const local = touched ? validate(g) : {};
  const errors = { ...serverErrors, ...local };
  const set = (k: keyof GuestForm) => (e: { target: { value: string } }) => setG({ ...g, [k]: e.target.value });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (Object.keys(validate(g)).length === 0) onSubmit(g);
  };

  const err = (k: string) => errors[k] && <div className="error">{errors[k]}</div>;

  return (
    <form className="card" onSubmit={submit} noValidate>
      <h2>Guest details</h2>
      <div className="row">
        <div className="field">
          <label htmlFor="title">Title</label>
          <select id="title" value={g.title} onChange={set("title")}>
            <option value="">—</option>
            {catalog.salutations.map((s) => (
              <option key={s.code} value={s.name}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="phone">WhatsApp number</label>
          <input id="phone" value={`+${phone}`} readOnly />
        </div>
      </div>
      <div className="row">
        <div className="field">
          <label htmlFor="firstName">First name *</label>
          <input id="firstName" autoComplete="given-name" value={g.firstName} onChange={set("firstName")} />
          {err("firstName")}
        </div>
        <div className="field">
          <label htmlFor="lastName">Last name *</label>
          <input id="lastName" autoComplete="family-name" value={g.lastName} onChange={set("lastName")} />
          {err("lastName")}
        </div>
      </div>
      <div className="field">
        <label htmlFor="email">Email *</label>
        <input id="email" type="email" autoComplete="email" inputMode="email" value={g.email} onChange={set("email")} />
        {err("email")}
      </div>
      <div className="field">
        <label htmlFor="address1">Address *</label>
        <input id="address1" autoComplete="address-line1" value={g.address1} onChange={set("address1")} />
        {err("address1")}
      </div>
      <div className="field">
        <label htmlFor="address2">Address line 2</label>
        <input id="address2" autoComplete="address-line2" value={g.address2} onChange={set("address2")} />
      </div>
      <div className="row">
        <div className="field">
          <label htmlFor="country">Country *</label>
          <select id="country" autoComplete="country" value={g.countryIso} onChange={set("countryIso")}>
            <option value="">Select…</option>
            {catalog.countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
          {err("countryIso")}
        </div>
        <div className="field">
          <label htmlFor="pin">PIN code *</label>
          <input id="pin" autoComplete="postal-code" inputMode={g.countryIso === "IN" ? "numeric" : "text"} value={g.pin} onChange={set("pin")} />
          {err("pin")}
        </div>
      </div>
      <div className="field">
        <label htmlFor="instructions">Special requests</label>
        <textarea id="instructions" maxLength={300} placeholder="Early check-in, arrival time…" value={g.instructions} onChange={set("instructions")} />
      </div>
      <div className="actions">
        <button type="button" className="btn-secondary" onClick={onBack} disabled={busy}>
          Back
        </button>
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "Holding your rooms…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
