import { createApp } from "./app.js";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { expireHolds } from "./services/booking.js";

const server = createApp().listen(config.PORT, () => {
  console.info(`WALIVE API listening on :${config.PORT} (PMS group ${config.PMS_GROUP_ID}, payments: ${config.PAYMENT_MODE})`);
});

// Release unpaid holds every minute (in-process, so no separate cron service is needed).
const sweep = setInterval(() => {
  expireHolds()
    .then((n) => n && console.info(`Expired ${n} hold(s).`))
    .catch((e) => console.error("Hold expiry failed", e));
}, 60_000);

async function shutdown() {
  clearInterval(sweep);
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
