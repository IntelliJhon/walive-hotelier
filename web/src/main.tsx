import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AdminApp } from "./admin/AdminApp";
import { BookingApp } from "./booking/BookingApp";
import "./styles.css";

function NoLink() {
  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          WALIVE <span>Booking</span>
        </div>
      </div>
      <div className="card">
        <h1>Open your booking link</h1>
        <p className="muted">Send “book” to us on WhatsApp and we’ll reply with a personal link to book your stay.</p>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/b/:token" element={<BookingApp />} />
        <Route path="/admin" element={<AdminApp />} />
        <Route path="*" element={<NoLink />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
