// Records due proposal reminders as queued. Run from cron: npm run reminders:run. Sends nothing.
import { closeDatabase, prisma } from "../server/db.js";
import { runReminders } from "../server/proposalReminders.js";

const dryRun = process.argv.includes("--dry-run");
try {
  const result = await runReminders(prisma, { dryRun });
  console.log(JSON.stringify({ due: result.due, queued: result.queued, alreadyQueued: result.alreadyQueued, dryRun: result.dryRun }));
} finally {
  await closeDatabase();
}
