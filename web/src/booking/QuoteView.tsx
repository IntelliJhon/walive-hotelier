import type { Quote, QuotedNight, QuotedStay } from "../api";
import { fmtDate, guestsLabel, money, plural } from "../format";
import { titleCase } from "./StayEditor";

/** Same price parts every night? Then the rate can be shown once as "per night". */
function sameEveryNight(nights: QuotedNight[]) {
  const key = (n: QuotedNight) => JSON.stringify([n.components, n.tax]);
  return nights.every((n) => key(n) === key(nights[0]));
}

function RateLines({ night, stay }: { night: QuotedNight; stay: QuotedStay }) {
  return (
    <>
      {night.components?.map((c) => (
        <div className="line small" key={c.label}>
          <span className="muted">{c.label.replace(/^Meals/, `Meals (${stay.mealPlan})`)}</span>
          <span className="num">{money(c.amount)}</span>
        </div>
      ))}
      <div className="line small">
        <span className="muted">GST</span>
        <span className="num">{money(night.tax)}</span>
      </div>
    </>
  );
}

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
          {s.rooms.map((r, ri) => {
            const hasParts = r.nights.some((n) => n.components?.length);
            const uniform = hasParts && sameEveryNight(r.nights);
            return (
              <div key={ri} style={{ marginBottom: 10 }}>
                <div className="line">
                  <span>
                    {titleCase(r.roomTypeName)} <span className="muted small">({guestsLabel(r)})</span>
                  </span>
                  <span className="num">{money(r.amount)}</span>
                </div>
                {uniform && (
                  <div className="rate-box">
                    <div className="small muted rate-title">
                      Rate per night{r.nights.length > 1 ? ` × ${plural(r.nights.length, "night")}` : ""}
                    </div>
                    <RateLines night={r.nights[0]} stay={s} />
                  </div>
                )}
                {(!uniform || r.nights.length > 1) && (
                  <details>
                    <summary className="small">Nightly breakdown</summary>
                    {r.nights.map((n) => (
                      <div key={n.date} className={hasParts && !uniform ? "rate-box" : undefined}>
                        <div className="line small muted">
                          <span>{fmtDate(n.date)}</span>
                          <span className="num">
                            {money(n.value)} + GST {money(n.tax)} = {money(n.amount)}
                          </span>
                        </div>
                        {hasParts && !uniform && <RateLines night={n} stay={s} />}
                      </div>
                    ))}
                  </details>
                )}
              </div>
            );
          })}
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
