import { z } from "zod";

const Env = z.object({
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  WEB_BASE_URL: z.string().url(),
  CORS_ORIGINS: z.string().default(""),

  PMS_BASE_URL: z.string().url(),
  PMS_KEY: z.string().min(1),
  PMS_SOURCE: z.string().default("WALIVE"),
  PMS_GROUP_ID: z.string().min(1),
  PMS_RATE_TYPE: z.string().default(""),
  PMS_TIMEOUT_MS: z.coerce.number().default(20000),
  CHECKIN_TIME: z.string().regex(/^\d{2}:\d{2}$/).default("12:00"),
  CHECKOUT_TIME: z.string().regex(/^\d{2}:\d{2}$/).default("11:00"),

  SESSION_MINUTES: z.coerce.number().int().positive().default(30),
  HOLD_MINUTES: z.coerce.number().int().positive().default(15),
  PAYMENT_MODE: z.enum(["test", "sbiepay"]).default("test"),

  CHAT_API_SECRET: z.string().min(16, "CHAT_API_SECRET must be at least 16 characters"),
  N8N_NOTIFY_URL: z.string().url().or(z.literal("")).default(""),
  /** The bot's WhatsApp number (digits with country code); the web app links back to it after booking. */
  BOT_WHATSAPP_NUMBER: z
    .string()
    .default("")
    .transform((s) => s.replace(/\D/g, "")),

  ADMIN_USER: z.string().min(1),
  ADMIN_PASSWORD: z.string().min(8, "ADMIN_PASSWORD must be at least 8 characters"),
});

export type Config = z.infer<typeof Env>;

export const config: Config = (() => {
  const parsed = Env.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    console.error(`Invalid environment configuration:\n${issues}`);
    process.exit(1);
  }
  return parsed.data;
})();
