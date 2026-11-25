import assert from "node:assert/strict";
import test from "node:test";
import { createProjectsStaffRouter } from "../../server/routes/projectsStaff.js";

test("projects/staff route module exports the staff and task routes", () => {
  const router = createProjectsStaffRouter({ prisma: {} as never });
  assert.equal(typeof router, "function");
  const routes = (router as typeof router & { stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }> }).stack.filter((layer) => layer.route).map((layer) => `${Object.keys(layer.route!.methods).sort().join(",")}:${layer.route!.path}`);
  assert.deepEqual(routes, ["get:/projects/:id/tasks", "patch:/tasks/:id", "get:/staff/escalations", "get:/staff/escalations/:id", "post:/staff/escalations/:id/claim", "post:/staff/escalations/:id/resolve", "get:/staff/approvals", "get:/staff/approvals/:id", "post:/staff/approvals/:id/approve", "post:/staff/approvals/:id/reject", "post:/staff/records/:type/:id/hold", "post:/staff/records/:type/:id/release", "get:/staff/conversations", "get:/staff/conversations/:id"]);
});
