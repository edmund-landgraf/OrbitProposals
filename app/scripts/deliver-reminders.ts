// Queues due reminders, runs ticklers, then sends queued client reminders.
// Disabled sending and --dry-run preview queued deliveries without changing reminder state.
import { prisma } from "../server/db.js";
import { runReminders } from "../server/proposalReminders.js";
import { deliverReminders, prismaDeliveryStore, runTicklers, sendersFromEnv } from "../server/reminderDelivery.js";

const dryRun = process.argv.includes("--dry-run") || process.env.UNWH_REMINDER_SEND_ENABLED !== "1" || process.env.UNWH_REMINDER_DRY_RUN === "1";
const now = new Date();
const store = prismaDeliveryStore(prisma as never);
const queued = await runReminders(prisma as never, { now, dryRun });
const ticklers = dryRun ? { outcomes: [] } : await runTicklers(store, { now });
const senders = sendersFromEnv();
const delivered = await deliverReminders(store, senders, { now, dryRun });
console.log(JSON.stringify({ dryRun, queued: queued.queued, ticklers: ticklers.outcomes, providers: { email: senders.email.provider, sms: senders.sms.provider }, deliveries: delivered.outcomes }, null, 2));
await prisma.$disconnect();
