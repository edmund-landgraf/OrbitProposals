import { createRequire } from "node:module";
import type { PrismaClient as PrismaClientInstance } from "@prisma/client";

// @prisma/client is CommonJS. Playwright's ESM loader does not surface
// PrismaClient as a named export, so runtime code loads it with require.
const require = createRequire(import.meta.url);
const prisma = require("@prisma/client") as typeof import("@prisma/client");

export const PrismaClient = prisma.PrismaClient;
export type PrismaClient = PrismaClientInstance;
export const Prisma = prisma.Prisma;
