# WALIVE Booking — Hotelier PMS

WhatsApp booking bot + booking web app for hotels running **The Hotelier PMS** ("Live Chat Interfacing" API v1.1).

```
Guest on WhatsApp ─▶ WAAU ─▶ n8n "HOTLIER" workflow (Gemini replies)
                                 │  creates booking link / reads bookings
                                 ▼
             web/ (React) ─▶ api/ (Express + Postgres) ─▶ Hotelier PMS
                                 │
                                 └─▶ n8n notify webhook ─▶ WhatsApp confirmation
```

| Folder | What |
|---|---|
| `api/` | Node + Express + Prisma (PostgreSQL). The only component that talks to the PMS. |
| `web/` | React + Vite booking page (`/b/<token>`) and admin dashboard (`/admin`). |
| `render.yaml` | Render blueprint: API, static site, Postgres, cron job (Singapore). |

## Booking flow

1. Guest asks to book on WhatsApp → n8n calls `POST /api/chat/sessions` → bot replies with a personal link (valid 30 min).
2. Web app loads hotels, room types, meal plans (`mis`, `hoteldetails`, `roomtypesdetails`, cached 6 h).
3. **Check price** → `getrate` + `getinventory` per room type, then `calcgst` per hotel.
4. **Hold rooms** → price is re-checked, then `softbook` with the calcgst lines (v1.1 GST requirement). Hold = 15 min.
5. **Pay (test)** → synthetic transaction → `confirmsoftbook` → `confirmId` → WhatsApp confirmation via n8n.

Statuses: `HOLDING → SOFT_BOOKED → PAID → CONFIRMING → CONFIRMED` (or `SOFTBOOK_FAILED`, `HOLD_EXPIRED`, `CONFIRM_FAILED`).

## PMS behaviour verified on the Hotelier test server

- `calcgst` prices **one room**: `single: 2` returns the same amount as `single: 1`. So each physical room is sent as its own `roomTypes[]` entry (the same `roomTypeId` may repeat), and totals are summed by the API.
- GST slab is chosen per room per night from that room's total: ≤ ₹7,500 → 5%, above → 18% (tariff and meal plan alike).
- Occupancy mapping: 1 adult = `single`; 2+ adults = `double` + `extraAdult` for each adult beyond 2; children = `extraChild1`; infants = `extraInfant` (no charge). Mixing `single` and `double` in one entry drops the double.
- `softbook` needs `hotels[]` **inside** `guestDetails`; each night's `rates[]` line is the full `calcgst` line + `mealPlan`.
- `roomtypesdetails` expects lowercase `groupid`; the `calcgst` response key is `roomtypes`.
- MIS typeIds: `H6` hotel types, `34` meal plans, `A1` salutations, `47` countries (ISO codes), `60` states, `31` cities.

### ⚠ Known PMS issue — children

For rooms with children, `calcgst` returns the child **tariff twice** (`extraChild2Tariff` echoes `extraChild1Tariff`) and drops the child meal plan, while the tax is correct. `softbook` then stores yet another total. Example (SUITE, 2 adults + 1 child, per night): correct ₹9,499, calcgst ₹10,049, PMS stored ₹9,060. Bookings without children match exactly. The API records a `TOTAL_MISMATCH` event and the admin list shows the PMS total in red. Reported to Hotelier.

## Local development

Requirements: Node 20+, PostgreSQL (Docker: `npm run db:up` → port 5433).

```bash
npm install
cp api/.env.example api/.env        # then set CHAT_API_SECRET and ADMIN_PASSWORD
npm run migrate:dev -w api          # create tables
npm run dev:api                     # http://localhost:4000
npm run dev:web                     # http://localhost:5173 (proxies /api to :4000)
npm test                            # unit tests (pricing rules)
```

Get a booking link without WhatsApp:

```bash
curl -X POST localhost:4000/api/chat/sessions -H "x-walive-secret: <CHAT_API_SECRET>" -H "Content-Type: application/json" -d '{"phone":"919876543210","name":"Test Guest"}'
```

## API

| Route | Auth | Used by |
|---|---|---|
| `POST /api/chat/sessions` `{phone, name}` → `{link, expiresAt}` | `x-walive-secret` | n8n |
| `GET /api/chat/bookings?phone=` | `x-walive-secret` | n8n ("my booking") |
| `GET /api/chat/context` → hotel/room text for the AI prompt | `x-walive-secret` | n8n |
| `GET /api/public/session`, `GET /api/public/catalog` | `Bearer <link token>` | web app |
| `POST /api/public/quote` `{stays:[…]}` | Bearer | web app |
| `POST /api/public/bookings` `{selection, guest, expectedTotal}` | Bearer | web app (softbook) |
| `POST /api/public/bookings/:id/pay-test` | Bearer | web app (test payment → confirm) |
| `GET /api/admin/bookings[/:id]`, `POST …/:id/retry-confirm`, `GET /api/admin/pms-calls` | Basic | admin |
| `GET /health` | – | Render |

Every PMS request/response is stored in `PmsCall` (API key masked) and visible per booking in the admin dashboard.

## n8n workflow "HOTLIER"

- `POST /webhook/hotlier-chat` — WAAU sends `{phone, name, message, audio_url}`; replies `{reply}`. Voice notes are transcribed with Gemini. The agent writes `[BOOK_LINK]`, which n8n replaces with a link from the API.
- `POST /webhook/hotlier-notify` — the API sends `{phone, event, text}` (header `x-walive-secret`); n8n sends it via the WAAU messages API.

Setup steps are on the sticky note in the workflow.

## Deploying to Render

1. Push this folder to GitHub → Render → **New → Blueprint** → select the repo.
2. After the first deploy, check the real service URLs; if they differ from `walive-api.onrender.com` / `walive-book.onrender.com`, update `WEB_BASE_URL`, `CORS_ORIGINS` (env group) and `VITE_API_URL` (static site), then redeploy.
3. Copy `CHAT_API_SECRET` from the env group into the n8n credential **WALIVE API secret** (header name `x-walive-secret`), and set `API_BASE` in the n8n *Normalize Input* node.
4. Point the HOTLIER WAAU bot's webhook to `https://<your-n8n>/webhook/hotlier-chat`.

## Production switch

Change `PMS_BASE_URL`, `PMS_KEY`, `PMS_GROUP_ID` and set `PAYMENT_MODE=sbiepay` once the SBI ePay integration is built (not yet implemented — `confirmBooking` already accepts any stored transaction).
