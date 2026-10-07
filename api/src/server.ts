import { createApp } from "./app.js";
import { config } from "./config.js";
import { prisma } from "./db.js";

const server = createApp().listen(config.PORT, () => {
  console.info(`WALIVE API listening on :${config.PORT} (PMS group ${config.PMS_GROUP_ID}, payments: ${config.PAYMENT_MODE})`);
});

async function shutdown() {
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
