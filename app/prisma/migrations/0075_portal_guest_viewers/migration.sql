ALTER TABLE "proposal_guest_invite" ADD COLUMN "user_id" UUID;

ALTER TABLE "proposal_guest_invite" ADD CONSTRAINT "proposal_guest_invite_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "proposal_guest_invite_user_id_status_idx" ON "proposal_guest_invite"("user_id", "status");
