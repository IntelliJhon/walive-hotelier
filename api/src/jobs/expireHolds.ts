// Cron job: marks unpaid soft bookings past their hold time as expired.
import { prisma } from "../db.js";
import { expireHolds } from "../services/booking.js";

try {
  const n = await expireHolds();
  console.info(`Expired ${n} hold(s).`);
} finally {
  await prisma.$disconnect();
}
