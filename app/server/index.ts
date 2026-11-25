import { randomUUID } from "node:crypto";
import cors from "cors";
import express from "express";
import connectPgSimple from "connect-pg-simple";
import session from "express-session";
import { API_SURFACE, assertApiSurface, registeredRoutes } from "./apiSurface.js";
import { checkDatabase, closeDatabase, prisma } from "./db.js";
import { waitUntilReady } from "../shared/retry.js";
import { logEvent } from "../shared/log.js";
import { createStatusRouter, requestLogger } from "./observability.js";
import { createBillingProjectsRouter } from "./routes/billingProjects.js";
import { createProposalExpiryRouter } from "./routes/proposalExpiry.js";
import { createCatalogEditRouter } from "./routes/catalogEdit.js";
import { createTemplateEditRouter } from "./routes/templateEdit.js";
import { createGuidanceCaseEditRouter } from "./routes/guidanceCaseEdit.js";
import { createChatProposalReadRouter } from "./routes/chatProposalRead.js";
import { createProposalRemindersRouter } from "./routes/proposalReminders.js";
import { createReminderDeliveryRouter } from "./routes/reminderDelivery.js";
import { createProjectsStaffRouter } from "./routes/projectsStaff.js";
import { createProposalContractRouter } from "./routes/proposalContract.js";
import { createFollowUpQueueRouter } from "./routes/followUpQueue.js";
import { createProposalReviewRouter } from "./routes/proposalReview.js";
import { createProposalCompletionRouter } from "./routes/proposalCompletion.js";
import { createFreeConsultRouter } from "./routes/freeConsult.js";
import { loadActiveCatalog, publicMcpScopes } from "./catalog.js";
import { createAdminPage, createAdminRouter } from "./routes/admin.js";
import { createProposalDuplicateRouter } from "./routes/proposalDuplicate.js";
import { createMfaRouter } from "./routes/mfa.js";
import { createSystemAuthRouter } from "./routes/systemAuth.js";
import { createCreditsRouter } from "./routes/credits.js";
import { createTimeEntriesRouter } from "./routes/timeEntries.js";
import { createAgentTracesRouter } from "./routes/agentTraces.js";
import { createDemoRouter } from "./routes/demo.js";
import { createAccessRequestRouter } from "./routes/accessRequests.js";
import { createProposalManagerRouter } from "./routes/proposalManager.js";
import { apiErrorHandler, logFinishedServerFailure } from "./apiErrorHandler.js";

const app = express();
const host = process.env.UNWH_API_HOST ?? "127.0.0.1";
const port = Number(process.env.UNWH_API_PORT ?? "3201");
const sessionSecret = process.env.UNWH_SESSION_SECRET;
if (!sessionSecret) throw new Error("UNWH_SESSION_SECRET is required");

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(logFinishedServerFailure);
app.use(requestLogger());
app.use(cors({ origin: false, credentials: true }));
app.use((request, response, next) => {
  const path = request.path;
  const largeAttachment = (request.method === "POST" || request.method === "PUT")
    && /^\/api\/v1\/proposals\/[^/]+\/attachments(?:\/[^/]+)?$/.test(path)
    && !path.endsWith("/attachments/order");
  express.json({ limit: largeAttachment ? "15mb" : "256kb" })(request, response, next);
});
const PgSession = connectPgSimple(session);
app.use(session({
  store: new PgSession({
    conString: process.env.DATABASE_URL,
    tableName: "session",
    pruneSessionInterval: 900,
    createTableIfMissing: false,
  }),
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 30 * 24 * 60 * 60 * 1000 },
}));

app.use(async (request, response, next) => {
  try {
    const userId = request.session?.userId;
    if (!userId) { next(); return; }
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { suspendedAt: true } });
    if (!user?.suspendedAt) { next(); return; }
    await new Promise<void>((resolve, reject) => request.session.destroy((error) => error ? reject(error) : resolve()));
    const onApi = request.originalUrl.startsWith("/api/");
    if (!onApi) { next(); return; }
    response.status(401).json({ ok: false, code: "AUTH_REQUIRED", message: "Authentication is required.", retryable: false, requestId: request.header("x-request-id") || randomUUID() });
  } catch (error) { next(error); }
});

const adminRouter = createAdminRouter({ prisma });
const proposalExpiryRouter = createProposalExpiryRouter({ prisma });
const mfaRouter = createMfaRouter({ prisma });
const systemAuthRouter = createSystemAuthRouter({ prisma, checkDatabase });
const proposalRemindersRouter = createProposalRemindersRouter({ prisma });
const reminderDeliveryRouter = createReminderDeliveryRouter({ prisma });
const chatProposalReadRouter = createChatProposalReadRouter({ prisma });
const proposalContractRouter = createProposalContractRouter({ prisma });
const followUpQueueRouter = createFollowUpQueueRouter({ prisma });
const proposalReviewRouter = createProposalReviewRouter({ prisma });
const proposalCompletionRouter = createProposalCompletionRouter({ prisma });
const freeConsultRouter = createFreeConsultRouter({ prisma });
const billingProjectsRouter = createBillingProjectsRouter({ prisma });
const catalogEditRouter = createCatalogEditRouter({ prisma });
const templateEditRouter = createTemplateEditRouter({ prisma });
const guidanceCaseEditRouter = createGuidanceCaseEditRouter({ prisma });
const proposalDuplicateRouter = createProposalDuplicateRouter({ prisma });
const projectsStaffRouter = createProjectsStaffRouter({ prisma });
const timeEntriesRouter = createTimeEntriesRouter({ prisma });
const creditsRouter = createCreditsRouter({ prisma });
const agentTracesRouter = createAgentTracesRouter({ prisma });
const demoRouter = createDemoRouter({ prisma });
const accessRequestRouter = createAccessRequestRouter({ prisma });
const proposalManagerRouter = createProposalManagerRouter({ prisma });

assertApiSurface(API_SURFACE, [
  ...registeredRoutes(adminRouter),
  ...registeredRoutes(proposalExpiryRouter),
  ...registeredRoutes(mfaRouter),
  ...registeredRoutes(systemAuthRouter),
  ...registeredRoutes(proposalRemindersRouter),
  ...registeredRoutes(reminderDeliveryRouter),
  ...registeredRoutes(chatProposalReadRouter),
  ...registeredRoutes(proposalContractRouter),
  ...registeredRoutes(followUpQueueRouter),
  ...registeredRoutes(proposalReviewRouter),
  ...registeredRoutes(proposalCompletionRouter),
  ...registeredRoutes(freeConsultRouter),
  ...registeredRoutes(billingProjectsRouter),
  ...registeredRoutes(catalogEditRouter),
  ...registeredRoutes(templateEditRouter),
    ...registeredRoutes(guidanceCaseEditRouter),
  ...registeredRoutes(proposalDuplicateRouter),
  ...registeredRoutes(projectsStaffRouter),
  ...registeredRoutes(timeEntriesRouter),
  ...registeredRoutes(creditsRouter),
  ...registeredRoutes(agentTracesRouter),
  ...registeredRoutes(demoRouter),
  ...registeredRoutes(accessRequestRouter),
  ...registeredRoutes(proposalManagerRouter),
  { method: "GET", path: "/.well-known/oauth-authorization-server" },
  { method: "GET", path: "/.well-known/openid-configuration" },
]);

app.get("/admin", createAdminPage({ prisma }));
app.use("/api/v1", adminRouter);
app.use("/api/v1", proposalExpiryRouter);
app.use("/api/v1", mfaRouter);
app.use("/api/v1", systemAuthRouter);
app.use("/api/v1", proposalRemindersRouter);
app.use("/api/v1", reminderDeliveryRouter);
app.use("/api/v1", proposalReviewRouter);
app.use("/api/v1", proposalCompletionRouter);
app.use("/api/v1", followUpQueueRouter);
app.use("/api/v1", chatProposalReadRouter);
app.use("/api/v1", proposalContractRouter);
app.use("/api/v1", freeConsultRouter);
app.use("/api/v1", billingProjectsRouter);
app.use("/api/v1", catalogEditRouter);
app.use("/api/v1", templateEditRouter);
app.use("/api/v1", guidanceCaseEditRouter);
app.use("/api/v1", proposalDuplicateRouter);
app.use("/api/v1", projectsStaffRouter);
app.use("/api/v1", timeEntriesRouter);
app.use("/api/v1", creditsRouter);
app.use("/api/v1", agentTracesRouter);
app.use("/api/v1", demoRouter);
app.use("/api/v1", accessRequestRouter);
app.use("/api/v1", proposalManagerRouter);
app.use("/api/v1", createStatusRouter({ checks: [{ name: "database", run: checkDatabase }] }));

app.get("/.well-known/oauth-authorization-server", async (_request, response, next) => {
  try {
    const origin = process.env.UNWH_API_PUBLIC_URL;
    if (!origin) { response.status(503).json({ ok: false, code: "CONFIGURATION_REQUIRED", message: "UNWH_API_PUBLIC_URL is required for OAuth discovery." }); return; }
    const catalog = await loadActiveCatalog(prisma);
    response.json({ issuer: origin, authorization_endpoint: `${origin}/api/v1/auth/mcp/authorize`, token_endpoint: `${origin}/api/v1/auth/mcp/token`, registration_endpoint: `${origin}/api/v1/auth/mcp/register`, revocation_endpoint: `${origin}/api/v1/auth/mcp/revoke`, scopes_supported: publicMcpScopes(catalog), code_challenge_methods_supported: ["S256"], response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"], token_endpoint_auth_methods_supported: ["none"] });
  } catch (error) { next(error); }
});

app.get("/.well-known/openid-configuration", async (_request, response, next) => {
  try {
    const origin = process.env.UNWH_API_PUBLIC_URL;
    if (!origin) { response.status(503).json({ ok: false, code: "CONFIGURATION_REQUIRED", message: "UNWH_API_PUBLIC_URL is required for OAuth discovery." }); return; }
    const catalog = await loadActiveCatalog(prisma);
    response.json({ issuer: origin, authorization_endpoint: `${origin}/api/v1/auth/mcp/authorize`, token_endpoint: `${origin}/api/v1/auth/mcp/token`, registration_endpoint: `${origin}/api/v1/auth/mcp/register`, revocation_endpoint: `${origin}/api/v1/auth/mcp/revoke`, scopes_supported: publicMcpScopes(catalog), code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"] });
  } catch (error) { next(error); }
});

app.get("/api/v1", (_request, response) => {
  response.json({ ok: true, count: API_SURFACE.length, operations: API_SURFACE });
});

for (const apiOperation of [...API_SURFACE].sort((left, right) => right.path.length - left.path.length)) {
  if (apiOperation.implemented) continue;
  app.all(`/api/v1${apiOperation.path}`, (request, response, next) => {
    if (request.method !== apiOperation.method) {
      next();
      return;
    }
    response.status(501).json({
      ok: false,
      code: "NOT_IMPLEMENTED",
      operation: apiOperation.id,
      method: apiOperation.method,
      path: apiOperation.path,
      auth: apiOperation.auth,
      scope: apiOperation.scope ?? null,
      message: "This operation is mapped in the Unwhelm API surface but its business implementation is scheduled for a later phase.",
    });
  });
}

app.use("/api/v1", (_request, response) => {
  response.status(404).json({ ok: false, code: "NOT_FOUND", message: "The isolated API foundation does not implement this route yet." });
});

app.use(apiErrorHandler);

app.get("/mcp", (_request, response) => {
  response.status(404).json({ ok: false, code: "MCP_NOT_CONNECTED", message: "The MCP listener is not connected to the web/API surface." });
});

// Wait (bounded) for Postgres before taking traffic; start anyway so /status can report degraded.
void waitUntilReady(checkDatabase, { label: "database" }).then(() => {
  app.listen(port, host, () => {
    logEvent("info", "listening", { service: "unwh-api", url: `http://${host}:${port}` });
  });
});

const shutdown = async () => {
  await closeDatabase();
  process.exit(0);
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
