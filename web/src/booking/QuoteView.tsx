import type { Quote } from "../api";
import { fmtDate, guestsLabel, money, plural } from "../format";
import { titleCase } from "./StayEditor";

export function QuoteView({ quote }: { quote: Quote }) {
  return (
    <div className="card">
      <h2>Price summary</h2>
      {quote.stays.map((s, si) => (
        <div key={si} style={{ marginBottom: 12 }}>
          <h3>{titleCase(s.hotelName)}</h3>
          <p className="muted small" style={{ marginBottom: 6 }}>
            {fmtDate(s.checkin)} → {fmtDate(s.checkout)} · {plural(s.nights, "night")} · {titleCase(s.mealPlanName)}
          </p>
          {s.rooms.map((r, ri) => (
            <div key={ri} style={{ marginBottom: 6 }}>
              <div className="line">
                <span>
                  {titleCase(r.roomTypeName)} <span className="muted small">({guestsLabel(r)})</span>
                </span>
                <span className="num">{money(r.amount)}</span>
              </div>
              <details>
                <summary className="small">Nightly breakdown</summary>
                {r.nights.map((n) => (
                  <div className="line small muted" key={n.date}>
                    <span>{fmtDate(n.date)}</span>
                    <span className="num">
                      {money(n.value)} + GST {money(n.tax)} = {money(n.amount)}
                    </span>
                  </div>
                ))}
              </details>
            </div>
          ))}
        </div>
      ))}
      <div className="line">
        <span className="muted">Room &amp; meal charges</span>
        <span className="num">{money(quote.value)}</span>
      </div>
      <div className="line">
        <span className="muted">GST</span>
        <span className="num">{money(quote.tax)}</span>
      </div>
      <div className="line total">
        <span>Total</span>
        <span className="num">{money(quote.amount)}</span>
      </div>
    </div>
  );
}
