import type { CatalogData, HotelInfo, RoomSel, StaySel } from "../api";
import { addDaysIso, nightsBetween, plural, todayIso } from "../format";
import { Stepper } from "./Stepper";

export function newRoom(hotel: HotelInfo): RoomSel {
  return { roomTypeId: hotel.roomTypes[0]?.roomTypeId ?? "", adults: Math.min(2, hotel.roomTypes[0]?.maxAdult || 2), children: 0, infants: 0 };
}

export function newStay(catalog: CatalogData, hotelId?: string, checkin?: string): StaySel {
  const hotel = catalog.hotels.find((h) => h.hotelId === hotelId) ?? catalog.hotels[0];
  const start = checkin ?? addDaysIso(todayIso(), 1);
  return {
    hotelId: hotel.hotelId,
    checkin: start,
    checkout: addDaysIso(start, 1),
    mealPlan: catalog.mealPlans.find((m) => m.code === "CP")?.code ?? catalog.mealPlans[0]?.code ?? "",
    rooms: [newRoom(hotel)],
  };
}

interface Props {
  index: number;
  stay: StaySel;
  catalog: CatalogData;
  showTitle: boolean;
  onChange: (stay: StaySel) => void;
  onRemove?: () => void;
}

export function StayEditor({ index, stay, catalog, showTitle, onChange, onRemove }: Props) {
  const hotel = catalog.hotels.find((h) => h.hotelId === stay.hotelId)!;
  const today = todayIso();
  const maxNights = hotel.maxRoomNights || 30;
  const maxCheckin = hotel.maxBookingDays ? addDaysIso(today, hotel.maxBookingDays) : undefined;
  const nights = nightsBetween(stay.checkin, stay.checkout);
  const maxRooms = hotel.bookableRooms || 10;

  const set = (patch: Partial<StaySel>) => onChange({ ...stay, ...patch });
  const setRoom = (i: number, patch: Partial<RoomSel>) =>
    set({ rooms: stay.rooms.map((r, j) => (j === i ? clampRoom(hotel, { ...r, ...patch }) : r)) });

  const changeHotel = (hotelId: string) => {
    const h = catalog.hotels.find((x) => x.hotelId === hotelId)!;
    set({ hotelId, rooms: stay.rooms.slice(0, h.bookableRooms || 10).map(() => newRoom(h)) });
  };

  const changeCheckin = (checkin: string) => {
    if (!checkin) return;
    const keep = nightsBetween(checkin, stay.checkout);
    set({ checkin, checkout: keep >= 1 && keep <= maxNights ? stay.checkout : addDaysIso(checkin, 1) });
  };

  return (
    <div className="card">
      {(showTitle || onRemove) && (
        <div className="room-head">
          <h2 style={{ margin: 0 }}>{showTitle ? `Stay ${index + 1}` : "Your stay"}</h2>
          {onRemove && (
            <button type="button" className="btn-danger-link" onClick={onRemove}>
              Remove stay
            </button>
          )}
        </div>
      )}

      <div className="field">
        <label htmlFor={`hotel-${index}`}>Hotel</label>
        <select id={`hotel-${index}`} value={stay.hotelId} onChange={(e) => changeHotel(e.target.value)}>
          {catalog.hotels.map((h) => (
            <option key={h.hotelId} value={h.hotelId}>
              {h.hotelName}
            </option>
          ))}
        </select>
      </div>

      <div className="row">
        <div className="field">
          <label htmlFor={`in-${index}`}>Check-in</label>
          <input id={`in-${index}`} type="date" value={stay.checkin} min={today} max={maxCheckin} onChange={(e) => changeCheckin(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`out-${index}`}>Check-out</label>
          <input
            id={`out-${index}`}
            type="date"
            value={stay.checkout}
            min={addDaysIso(stay.checkin, 1)}
            max={addDaysIso(stay.checkin, maxNights)}
            onChange={(e) => e.target.value && set({ checkout: e.target.value })}
          />
        </div>
      </div>
      <p className="muted small" style={{ marginTop: -4 }}>
        {nights >= 1 ? plural(nights, "night") : "Check-out must be after check-in"} · up to {plural(maxNights, "night")} per booking
      </p>

      <div className="field">
        <label htmlFor={`meal-${index}`}>Meal plan</label>
        <select id={`meal-${index}`} value={stay.mealPlan} onChange={(e) => set({ mealPlan: e.target.value })}>
          {catalog.mealPlans.map((m) => (
            <option key={m.code} value={m.code}>
              {titleCase(m.name)} ({m.code})
            </option>
          ))}
        </select>
      </div>

      {stay.rooms.map((room, i) => {
        const rt = hotel.roomTypes.find((r) => r.roomTypeId === room.roomTypeId)!;
        const paxLeft = (rt?.maximumPax || 99) - room.adults - room.children;
        return (
          <div className="room" key={i}>
            <div className="room-head">
              <h3 style={{ margin: 0 }}>Room {i + 1}</h3>
              {stay.rooms.length > 1 && (
                <button type="button" className="btn-danger-link" onClick={() => set({ rooms: stay.rooms.filter((_, j) => j !== i) })}>
                  Remove
                </button>
              )}
            </div>
            <div className="field">
              <label htmlFor={`rt-${index}-${i}`}>Room type</label>
              <select id={`rt-${index}-${i}`} value={room.roomTypeId} onChange={(e) => setRoom(i, { roomTypeId: e.target.value })}>
                {hotel.roomTypes.map((r) => (
                  <option key={r.roomTypeId} value={r.roomTypeId}>
                    {titleCase(r.roomTypeName)} · up to {r.maximumPax} guests
                  </option>
                ))}
              </select>
            </div>
            {rt && (
              <div className="row3">
                <Stepper label="Adults" value={room.adults} min={1} max={Math.min(rt.maxAdult || 4, room.adults + paxLeft)} onChange={(n) => setRoom(i, { adults: n })} />
                <Stepper label="Children" value={room.children} min={0} max={Math.min(rt.maxChildren, room.children + paxLeft)} onChange={(n) => setRoom(i, { children: n })} />
                <Stepper label="Infants" value={room.infants} min={0} max={rt.maxInfant} onChange={(n) => setRoom(i, { infants: n })} />
              </div>
            )}
          </div>
        );
      })}

      {stay.rooms.length < maxRooms && (
        <button type="button" className="btn-link" onClick={() => set({ rooms: [...stay.rooms, newRoom(hotel)] })}>
          + Add another room
        </button>
      )}
    </div>
  );
}

/** Keeps guest counts within the room type's limits after a change. */
function clampRoom(hotel: HotelInfo, r: RoomSel): RoomSel {
  const rt = hotel.roomTypes.find((x) => x.roomTypeId === r.roomTypeId);
  if (!rt) return r;
  const adults = Math.max(1, Math.min(r.adults, rt.maxAdult || r.adults));
  const children = Math.max(0, Math.min(r.children, rt.maxChildren, (rt.maximumPax || 99) - adults));
  const infants = Math.max(0, Math.min(r.infants, rt.maxInfant));
  return { ...r, adults, children, infants };
}

export function titleCase(s: string) {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}
