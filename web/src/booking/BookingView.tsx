import { useEffect, useState } from "react";
import { ApiError, type Booking, type GuestApi } from "../api";
import { money } from "../format";
import { QuoteView } from "./QuoteView";

function useCountdown(until: string | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!until) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [until]);
  if (!until) return null;
  const ms = Math.max(new Date(until).getTime() - now, 0);
  return { ms, label: `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}` };
}

interface Props {
  booking: Booking;
  api: GuestApi;
  testMode: boolean;
  onChange: (b: Booking) => void;
  onNew: () => void;
}

export function BookingView({ booking, api, testMode, onChange, onNew }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const countdown = useCountdown(booking.status === "SOFT_BOOKED" ? booking.holdExpiresAt : null);
  const holdOver = countdown !== null && countdown.ms === 0;

  // While the PMS confirmation is in flight, poll until it settles.
  useEffect(() => {
    if (booking.status !== "PAID" && booking.status !== "CONFIRMING") return;
    const t = setInterval(() => api.booking(booking.id).then(onChange).catch(() => {}), 3000);
    return () => clearInterval(t);
  }, [booking.status, booking.id, api, onChange]);

  const pay = async () => {
    setBusy(true);
    setError("");
    try {
      onChange(await api.payTest(booking.id));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Payment failed. Please try again.");
      api.booking(booking.id).then(onChange).catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {booking.status === "CONFIRMED" && (
        <div className="card center">
          <div className="big-check">✅</div>
          <h1>Booking confirmed</h1>
          <p className="muted">We’ve also sent the confirmation to your WhatsApp.</p>
          <dl className="kv" style={{ textAlign: "left", maxWidth: 320, margin: "12px auto 0" }}>
            <dt>Confirmation no.</dt>
            <dd>{booking.confirmId}</dd>
            <dt>Reference</dt>
            <dd>{booking.reference}</dd>
            <dt>Total paid</dt>
            <dd>{money(booking.totalAmount)}</dd>
          </dl>
        </div>
      )}

      {booking.status === "SOFT_BOOKED" && !holdOver && (
        <div className="card">
          <h1>Your rooms are on hold</h1>
          <p className="muted">
            Complete payment within <strong>{countdown?.label}</strong> to confirm. Reference {booking.reference}.
          </p>
          {testMode ? (
            <>
              <div className="alert warn">Test mode: no money is charged. This sends a test payment to the hotel system.</div>
              <button className="btn-primary" onClick={pay} disabled={busy}>
                {busy ? "Confirming with the hotel…" : `Pay ${money(booking.totalAmount)} (test)`}
              </button>
            </>
          ) : (
            <div className="alert info">Online payment is being set up. Our team will contact you to complete payment.</div>
          )}
        </div>
      )}

      {(booking.status === "HOLD_EXPIRED" || holdOver) && (
        <div className="card">
          <h1>Room hold expired</h1>
          <p className="muted">Payment wasn’t completed in time, so the rooms were released. You can start again — prices and availability will be rechecked.</p>
          <button className="btn-primary" onClick={onNew}>
            Start a new booking
          </button>
        </div>
      )}

      {(booking.status === "PAID" || booking.status === "CONFIRMING") && (
        <div className="card">
          <h1>Confirming with the hotel…</h1>
          <p className="muted">Payment received. This usually takes a few seconds.</p>
        </div>
      )}

      {booking.status === "CONFIRM_FAILED" && (
        <div className="card">
          <h1>Payment received — confirmation pending</h1>
          <div className="alert warn">The hotel hasn’t confirmed the booking yet. Our team is checking and will update you on WhatsApp. Reference {booking.reference}.</div>
        </div>
      )}

      {booking.status === "SOFTBOOK_FAILED" && (
        <div className="card">
          <h1>We couldn’t hold these rooms</h1>
          <div className="alert error">{booking.failureReason}</div>
          <button className="btn-primary" onClick={onNew}>
            Try different options
          </button>
        </div>
      )}

      {error && <div className="alert error">{error}</div>}
      <QuoteView quote={booking.quote} />
      {booking.status === "CONFIRMED" && (
        <button className="btn-secondary" style={{ width: "100%" }} onClick={onNew}>
          Book another stay
        </button>
      )}
    </>
  );
}
