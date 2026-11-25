-- Client org onboarding: assignable membership roles and token scope presets live in rows.
CREATE TABLE "membership_role_option" (
  "role" "Role" NOT NULL PRIMARY KEY,
  "label" TEXT NOT NULL,
  "assignable" BOOLEAN NOT NULL DEFAULT true,
  "default_for_new_member" BOOLEAN NOT NULL DEFAULT false,
  "sort_order" INTEGER NOT NULL DEFAULT 0
);
INSERT INTO "membership_role_option" ("role", "label", "assignable", "default_for_new_member", "sort_order") VALUES
  ('client', 'Client', true, true, 10),
  ('staff', 'Staff', true, false, 20),
  ('prospect', 'Prospect', true, false, 30)
ON CONFLICT ("role") DO NOTHING;

CREATE TABLE "scope_preset" (
  "code" TEXT NOT NULL PRIMARY KEY,
  "label" TEXT NOT NULL,
  "scopes" TEXT[] NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 0
);
INSERT INTO "scope_preset" ("code", "label", "scopes", "active", "sort_order") VALUES
  ('client', 'Client', ARRAY['proposals:read', 'proposals:write', 'contracts:write', 'billing:read', 'projects:read'], true, 10)
ON CONFLICT ("code") DO NOTHING;
