import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { ApiError, guestApi, type Booking, type CatalogData, type GuestForm, type Quote, type SessionInfo, type StaySel } from "../api";
import { addDaysIso, fmtDate, money } from "../format";
import { BookingView } from "./BookingView";
import { emptyGuest, GuestFormView } from "./GuestFormView";
import { QuoteView } from "./QuoteView";
import { newStay, StayEditor, titleCase } from "./StayEditor";

type Step = "home" | "select" | "review" | "guest" | "booking";

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  CONFIRMED: { text: "Confirmed", cls: "ok" },
  SOFT_BOOKED: { text: "On hold", cls: "accent" },
  PAID: { text: "Confirming", cls: "accent" },
  CONFIRMING: { text: "Confirming", cls: "accent" },
  CONFIRM_FAILED: { text: "Pending", cls: "test" },
  HOLD_EXPIRED: { text: "Expired", cls: "" },
  SOFTBOOK_FAILED: { text: "Not booked", cls: "danger" },
  PAYMENT_FAILED: { text: "Payment failed", cls: "danger" },
};

/** Draft is kept in sessionStorage so a refresh doesn't lose the guest's choices. */
function useDraft<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = sessionStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage unavailable: draft just won't survive a refresh */
    }
  }, [key, value]);
  return [value, setValue] as const;
}

export function BookingApp() {
  const { token = "" } = useParams();
  const api = useMemo(() => guestApi(token), [token]);
  const draftKey = `walive-draft-${token.slice(0, 12)}`;

  const [session, setSession] = useState<SessionInfo>();
  const [catalog, setCatalog] = useState<CatalogData>();
  const [loadError, setLoadError] = useState("");
  const [step, setStep] = useState<Step>("home");
  const [stays, setStays] = useDraft<StaySel[]>(`${draftKey}-stays`, []);
  const [guest, setGuest] = useDraft<GuestForm | null>(`${draftKey}-guest`, null);
  const [quote, setQuote] = useState<Quote>();
  const [booking, setBooking] = useState<Booking>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    Promise.all([api.session(), api.catalog()])
      .then(([s, c]) => {
        setSession(s);
        setCatalog(c);
        if (!c.hotels.length) return setLoadError("No hotels are available for booking right now.");
        setStays((prev) => (prev.length && prev.every((p) => c.hotels.some((h) => h.hotelId === p.hotelId)) ? prev : [newStay(c)]));
        const active = s.bookings.find((b) => ["SOFT_BOOKED", "PAID", "CONFIRMING"].includes(b.status));
        if (active) {
          setBooking(active);
          setStep("booking");
        } else {
          setStep(s.bookings.length ? "home" : "select");
        }
      })
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : "Couldn't load the booking page."));
  }, [api, setStays]);

  const onBookingChange = useCallback((b: Booking) => {
    setBooking(b);
    setSession((s) => (s ? { ...s, bookings: [b, ...s.bookings.filter((x) => x.id !== b.id)] } : s));
  }, []);

  const go = (s: Step) => {
    setError("");
    setNotice("");
    setStep(s);
    window.scrollTo({ top: 0 });
  };

  const startNew = () => {
    if (catalog) setStays([newStay(catalog)]);
    setQuote(undefined);
    setBooking(undefined);
    go("select");
  };

  const getPrice = async () => {
    setBusy(true);
    setError("");
    try {
      setQuote(await api.quote({ stays }));
      go("review");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't get the price. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const hold = async (g: GuestForm) => {
    if (!quote) return;
    setGuest(g);
    setBusy(true);
    setError("");
    setFieldErrors({});
    try {
      const b = await api.book({ stays }, g, quote.amount);
      onBookingChange(b);
      go("booking");
    } catch (e) {
      if (e instanceof ApiError && e.code === "PRICE_CHANGED" && e.details?.quote) {
        setQuote(e.details.quote);
        go("review");
        setNotice("The price changed since you checked. Please review the new total before continuing.");
      } else if (e instanceof ApiError && e.code === "VALIDATION" && e.issues) {
        setFieldErrors(Object.fromEntries(e.issues.map((i) => [i.path.replace(/^guest\./, ""), i.message])));
        setError(e.message);
      } else {
        setError(e instanceof ApiError ? e.message : "Couldn't hold the rooms. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  };

  const header = (
    <div className="topbar">
      <div className="brand">
        WALIVE <span>Booking</span>
      </div>
      {session?.testMode && <span className="badge test">TEST</span>}
    </div>
  );

  if (loadError)
    return (
      <div className="app">
        {header}
        <div className="card">
          <h1>Link problem</h1>
          <p className="muted">{loadError}</p>
        </div>
      </div>
    );
  if (!session || !catalog)
    return (
      <div className="app">
        {header}
        <p className="muted">Loading…</p>
      </div>
    );

  const stepIndex = { home: 0, select: 1, review: 2, guest: 3, booking: 4 }[step];
  const datesValid = stays.every((s) => s.checkout > s.checkin);

  return (
    <div className="app">
      {header}
      {step !== "home" && step !== "booking" && (
        <div className="steps" aria-hidden>
          {[1, 2, 3].map((i) => (
            <div key={i} className={i <= stepIndex ? "on" : ""} />
          ))}
        </div>
      )}
      {session.expired && step !== "booking" && step !== "home" && (
        <div className="alert warn">This link has expired. Send “book” on WhatsApp to get a new one.</div>
      )}
      {notice && <div className="alert warn">{notice}</div>}

      {step === "home" && (
        <>
          <h1>Hi{session.name ? ` ${session.name.split(" ")[0]}` : ""} 👋</h1>
          <p className="muted">Your bookings from this link:</p>
          {session.bookings.map((b) => (
            <button
              key={b.id}
              className="card"
              style={{ display: "block", width: "100%", textAlign: "left", color: "inherit" }}
              onClick={() => {
                setBooking(b);
                go("booking");
              }}
            >
              <div className="line">
                <strong>{b.reference}</strong>
                <span className={`badge ${STATUS_LABEL[b.status]?.cls ?? ""}`}>{STATUS_LABEL[b.status]?.text ?? b.status}</span>
              </div>
              <div className="muted small">
                {b.quote.stays.map((s) => `${titleCase(s.hotelName)}, ${fmtDate(s.checkin)}`).join(" · ")} · {money(b.totalAmount)}
              </div>
            </button>
          ))}
          {!session.expired && (
            <button className="btn-primary" onClick={startNew}>
              Start a new booking
            </button>
          )}
        </>
      )}

      {step === "select" && (
        <>
          <h1>Book your stay</h1>
          <p className="muted">Choose hotel, dates and rooms. Prices include GST.</p>
          {stays.map((s, i) => (
            <StayEditor
              key={i}
              index={i}
              stay={s}
              catalog={catalog}
              showTitle={stays.length > 1}
              onChange={(ns) => setStays(stays.map((x, j) => (j === i ? ns : x)))}
              onRemove={stays.length > 1 ? () => setStays(stays.filter((_, j) => j !== i)) : undefined}
            />
          ))}
          {stays.length < 5 && (
            <button className="btn-link" onClick={() => setStays([...stays, newStay(catalog, undefined, stays[stays.length - 1]?.checkout ?? addDaysIso(stays[0].checkin, 1))])}>
              + Add another hotel
            </button>
          )}
          {error && <div className="alert error">{error}</div>}
          <div className="actions">
            {session.bookings.length > 0 && (
              <button className="btn-secondary" onClick={() => go("home")}>
                Back
              </button>
            )}
            <button className="btn-primary" onClick={getPrice} disabled={busy || session.expired || !datesValid}>
              {busy ? "Checking availability…" : "Check price"}
            </button>
          </div>
        </>
      )}

      {step === "review" && quote && (
        <>
          <h1>Review price</h1>
          <QuoteView quote={quote} />
          <div className="actions">
            <button className="btn-secondary" onClick={() => go("select")}>
              Change
            </button>
            <button className="btn-primary" onClick={() => go("guest")} disabled={session.expired}>
              Continue
            </button>
          </div>
        </>
      )}

      {step === "guest" && quote && (
        <>
          <h1>Almost done</h1>
          <p className="muted">We’ll hold your rooms for {session.holdMinutes} minutes while you pay.</p>
          {error && <div className="alert error">{error}</div>}
          <GuestFormView
            catalog={catalog}
            phone={session.phone}
            initial={guest ?? emptyGuest(session.name)}
            busy={busy}
            serverErrors={fieldErrors}
            submitLabel={`Hold rooms · ${money(quote.amount)}`}
            onBack={() => go("review")}
            onSubmit={hold}
          />
        </>
      )}

      {step === "booking" && booking && (
        <BookingView
          booking={booking}
          api={api}
          testMode={session.testMode}
          botWhatsApp={session.botWhatsApp}
          onChange={onBookingChange}
          onNew={startNew}
        />
      )}
    </div>
  );
}
