import assert from "node:assert/strict";
import test from "node:test";
import { API_SURFACE, assertApiSurface, registeredRoutes } from "../../server/apiSurface.js";
import { checkDatabase, prisma } from "../../server/db.js";
import { createAdminRouter } from "../../server/routes/admin.js";
import { createProposalDuplicateRouter } from "../../server/routes/proposalDuplicate.js";
import { createMfaRouter } from "../../server/routes/mfa.js";
import { createBillingProjectsRouter } from "../../server/routes/billingProjects.js";
import { createProposalExpiryRouter } from "../../server/routes/proposalExpiry.js";
import { createCatalogEditRouter } from "../../server/routes/catalogEdit.js";
import { createChatProposalReadRouter } from "../../server/routes/chatProposalRead.js";
import { createProposalRemindersRouter } from "../../server/routes/proposalReminders.js";
import { createProjectsStaffRouter } from "../../server/routes/projectsStaff.js";
import { createProposalContractRouter } from "../../server/routes/proposalContract.js";
import { createFollowUpQueueRouter } from "../../server/routes/followUpQueue.js";
import { createProposalReviewRouter } from "../../server/routes/proposalReview.js";
import { createProposalCompletionRouter } from "../../server/routes/proposalCompletion.js";
import { createFreeConsultRouter } from "../../server/routes/freeConsult.js";
import { createSystemAuthRouter } from "../../server/routes/systemAuth.js";
import { createAccessRequestRouter } from "../../server/routes/accessRequests.js";
import { createCreditsRouter } from "../../server/routes/credits.js";
import { createTimeEntriesRouter } from "../../server/routes/timeEntries.js";
import { createProposalManagerRouter } from "../../server/routes/proposalManager.js";

const mountedRoutes = [
  ...registeredRoutes(createAdminRouter({ prisma })),
  ...registeredRoutes(createProposalExpiryRouter({ prisma })),
  ...registeredRoutes(createMfaRouter({ prisma })),
  ...registeredRoutes(createSystemAuthRouter({ prisma, checkDatabase })),
  ...registeredRoutes(createAccessRequestRouter({ prisma })),
  ...registeredRoutes(createProposalRemindersRouter({ prisma })),
  ...registeredRoutes(createChatProposalReadRouter({ prisma })),
  ...registeredRoutes(createProposalContractRouter({ prisma })),
  ...registeredRoutes(createFollowUpQueueRouter({ prisma })),
  ...registeredRoutes(createProposalReviewRouter({ prisma })),
  ...registeredRoutes(createProposalCompletionRouter({ prisma })),
  ...registeredRoutes(createFreeConsultRouter({ prisma })),
  ...registeredRoutes(createBillingProjectsRouter({ prisma })),
  ...registeredRoutes(createCatalogEditRouter({ prisma })),
  ...registeredRoutes(createProposalDuplicateRouter({ prisma })),
  ...registeredRoutes(createProjectsStaffRouter({ prisma })),
  ...registeredRoutes(createTimeEntriesRouter({ prisma })),
  ...registeredRoutes(createProposalManagerRouter({ prisma })),
  ...registeredRoutes(createCreditsRouter({ prisma })),
  { method: "GET" as const, path: "/.well-known/oauth-authorization-server" },
  { method: "GET" as const, path: "/.well-known/openid-configuration" },
];

test("operation ids are unique and every mounted route is on the API surface", () => {
  assert.equal(new Set(API_SURFACE.map((operation) => operation.id)).size, API_SURFACE.length);
  assertApiSurface(API_SURFACE, mountedRoutes);
  assert.ok(mountedRoutes.length > 0);
});

test("duplicate operation ids fail the surface check", () => {
  const duplicate = { ...API_SURFACE[0], path: "/not-a-real-route" };
  assert.throws(() => assertApiSurface([API_SURFACE[0], duplicate], []), /Duplicate API operation id/);
});
