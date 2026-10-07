import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import { ZodError } from "zod";
import { config } from "./config.js";
import { AppError } from "./errors.js";
import { adminRoutes } from "./http/adminRoutes.js";
import { chatRoutes } from "./http/chatRoutes.js";
import { publicRoutes } from "./http/publicRoutes.js";

export function createApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.use(helmet());
  const origins = config.CORS_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean);
  app.use(cors({ origin: origins.length ? origins : false }));
  app.use(express.json({ limit: "200kb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });
  app.use("/api/chat", chatRoutes);
  app.use("/api/public", publicRoutes);
  app.use("/api/admin", adminRoutes);

  app.use((_req, _res, next) => next(new AppError(404, "NOT_FOUND", "Not found.")));

  // Express 5 forwards rejected promises from async handlers here.
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      res.status(400).json({
        code: "VALIDATION",
        message: err.issues[0]?.message ?? "Invalid request.",
        issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
      return;
    }
    if (err instanceof AppError) {
      if (err.status >= 500) console.error(`${req.method} ${req.path}: ${err.code}`, err.details ?? "");
      res.status(err.status).json({ code: err.code, message: err.message, ...(err.status < 500 && err.details ? { details: err.details } : {}) });
      return;
    }
    console.error(`${req.method} ${req.path}`, err);
    res.status(500).json({ code: "INTERNAL", message: "Something went wrong. Please try again." });
  });

  return app;
}
