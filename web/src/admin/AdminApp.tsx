import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ApiError, request } from "../api";
import { money } from "../format";

interface Row {
  id: string;
  reference: string;
  phone: string;
  status: string;
  guest: { firstName?: string; lastName?: string; email?: string };
  totalAmount: number;
  pmsTotal: number | null;
  softBookId: string | null;
  confirmId: string | null;
  failureReason: string | null;
  createdAt: string;
}

interface Detail extends Row {
  quote: { stays: { hotelName: string; checkin: string; checkout: string; rooms: unknown[] }[] };
  totalTax: number;
  events: { id: string; type: string; note: string | null; createdAt: string }[];
  payments: { id: string; gateway: string; transactionId: string; amount: number; status: string; createdAt: string }[];
  pmsCalls: { id: string; action: string; request: unknown; response: unknown; statuscode: number | null; message: string | null; error: string | null; durationMs: number; createdAt: string }[];
}

const STATUSES = ["", "SOFT_BOOKED", "PAID", "CONFIRMING", "CONFIRMED", "CONFIRM_FAILED", "HOLD_EXPIRED", "SOFTBOOK_FAILED", "HOLDING"];
const AUTH_KEY = "walive-admin-auth";
const time = (s: string) => new Date(s).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" });

function readAuth() {
  try {
    return sessionStorage.getItem(AUTH_KEY) ?? "";
  } catch {
    return "";
  }
}

export function AdminApp() {
  const [auth, setAuth] = useState(readAuth);
  const [rows, setRows] = useState<Row[]>([]);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<Detail>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const logout = useCallback(() => {
    try {
      sessionStorage.removeItem(AUTH_KEY);
    } catch {
      /* ignore */
    }
    setAuth("");
  }, []);

  const call = useCallback(
    async <T,>(path: string, init?: RequestInit) => {
      try {
        return await request<T>(path, { ...init, auth });
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) logout();
        throw e;
      }
    },
    [auth, logout],
  );

  const load = useCallback(async () => {
    if (!auth) return;
    setError("");
    const qs = new URLSearchParams({ ...(status ? { status } : {}), ...(search.trim() ? { search: search.trim() } : {}) });
    try {
      setRows(await call<Row[]>(`/api/admin/bookings?${qs}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [auth, status, search, call]);

  useEffect(() => {
    load();
  }, [load]);

  const open = async (id: string) => {
    try {
      setDetail(await call<Detail>(`/api/admin/bookings/${id}`));
      window.scrollTo({ top: 0 });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const retry = async () => {
    if (!detail) return;
    setBusy(true);
    try {
      await call(`/api/admin/bookings/${detail.id}/retry-confirm`, { method: "POST" });
      await open(detail.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!auth) return <Login onLogin={setAuth} />;

  return (
    <div className="app wide">
      <div className="topbar">
        <div className="brand">
          WALIVE <span>Admin</span>
        </div>
        <button className="btn-link" onClick={logout}>
          Sign out
        </button>
      </div>
      {error && <div className="alert error">{error}</div>}

      {detail ? (
        <>
          <button className="btn-link" onClick={() => setDetail(undefined)}>
            ← All bookings
          </button>
          <div className="card">
            <div className="line">
              <h2 style={{ margin: 0 }}>{detail.reference}</h2>
              <span className="badge">{detail.status}</span>
            </div>
            <dl className="kv" style={{ marginTop: 12 }}>
              <dt>Guest</dt>
              <dd>
                {detail.guest.firstName} {detail.guest.lastName} · {detail.guest.email} · +{detail.phone}
              </dd>
              <dt>Stays</dt>
              <dd>{detail.quote.stays.map((s) => `${s.hotelName} ${s.checkin}→${s.checkout} (${s.rooms.length} room)`).join("; ")}</dd>
              <dt>Total</dt>
              <dd>
                {money(detail.totalAmount)} (GST {money(detail.totalTax)}) · PMS total {detail.pmsTotal === null ? "—" : money(detail.pmsTotal)}
              </dd>
              <dt>softBookId</dt>
              <dd>{detail.softBookId ?? "—"}</dd>
              <dt>confirmId</dt>
              <dd>{detail.confirmId ?? "—"}</dd>
              {detail.failureReason && (
                <>
                  <dt>Failure</dt>
                  <dd style={{ color: "var(--danger)" }}>{detail.failureReason}</dd>
                </>
              )}
            </dl>
            {(detail.status === "CONFIRM_FAILED" || detail.status === "PAID") && (
              <button className="btn-primary" style={{ marginTop: 12, width: "auto" }} onClick={retry} disabled={busy}>
                {busy ? "Retrying…" : "Retry confirmation"}
              </button>
            )}
          </div>

          <div className="card">
            <h2>Timeline</h2>
            {detail.events.map((e) => (
              <div className="line small" key={e.id}>
                <span>
                  <strong>{e.type}</strong> {e.note}
                </span>
                <span className="muted">{time(e.createdAt)}</span>
              </div>
            ))}
            {detail.payments.map((p) => (
              <div className="line small" key={p.id}>
                <span>
                  Payment {p.gateway} {p.transactionId} · {money(p.amount)} · {p.status}
                </span>
                <span className="muted">{time(p.createdAt)}</span>
              </div>
            ))}
          </div>

          <div className="card">
            <h2>PMS calls</h2>
            {detail.pmsCalls.length === 0 && <p className="muted small">No calls linked to this booking.</p>}
            {detail.pmsCalls.map((c) => (
              <details key={c.id} style={{ marginBottom: 8 }}>
                <summary>
                  {c.action} · {c.error ? "error" : c.statuscode === 0 ? "ok" : `failed: ${c.message}`} · {c.durationMs} ms · {time(c.createdAt)}
                </summary>
                {c.error && <div className="alert error">{c.error}</div>}
                <div className="small muted" style={{ marginTop: 6 }}>Request</div>
                <pre>{JSON.stringify(c.request, null, 2)}</pre>
                <div className="small muted" style={{ marginTop: 6 }}>Response</div>
                <pre>{JSON.stringify(c.response, null, 2)}</pre>
              </details>
            ))}
          </div>
        </>
      ) : (
        <div className="card">
          <div className="toolbar" style={{ marginBottom: 12 }}>
            <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s || "All statuses"}
                </option>
              ))}
            </select>
            <input placeholder="Reference, phone, softBookId…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <button className="btn-secondary" onClick={load}>
              Refresh
            </button>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Created</th>
                  <th>Reference</th>
                  <th>Guest</th>
                  <th>Status</th>
                  <th>Total</th>
                  <th>softBookId</th>
                  <th>confirmId</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="clickable" onClick={() => open(r.id)}>
                    <td>{time(r.createdAt)}</td>
                    <td>{r.reference}</td>
                    <td>
                      {r.guest.firstName} {r.guest.lastName}
                      <div className="muted">+{r.phone}</div>
                    </td>
                    <td>
                      {r.status}
                      {r.failureReason && <div style={{ color: "var(--danger)" }}>{r.failureReason}</div>}
                    </td>
                    <td>
                      {money(r.totalAmount)}
                      {r.pmsTotal !== null && Math.abs(r.pmsTotal - r.totalAmount) > 0.5 && (
                        <div style={{ color: "var(--danger)" }}>PMS: {money(r.pmsTotal)}</div>
                      )}
                    </td>
                    <td>{r.softBookId ?? "—"}</td>
                    <td>{r.confirmId ?? "—"}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="muted">
                      No bookings yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Login({ onLogin }: { onLogin: (auth: string) => void }) {
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [error, setError] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const auth = `Basic ${btoa(`${user}:${pass}`)}`;
    try {
      await request("/api/admin/bookings?status=CONFIRMED", { auth });
      try {
        sessionStorage.setItem(AUTH_KEY, auth);
      } catch {
        /* stays signed in until refresh */
      }
      onLogin(auth);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? "Wrong username or password." : "Can't reach the API.");
    }
  };

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          WALIVE <span>Admin</span>
        </div>
      </div>
      <form className="card" onSubmit={submit}>
        <h2>Sign in</h2>
        {error && <div className="alert error">{error}</div>}
        <div className="field">
          <label htmlFor="u">Username</label>
          <input id="u" autoComplete="username" value={user} onChange={(e) => setUser(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="p">Password</label>
          <input id="p" type="password" autoComplete="current-password" value={pass} onChange={(e) => setPass(e.target.value)} />
        </div>
        <button className="btn-primary">Sign in</button>
      </form>
    </div>
  );
}
