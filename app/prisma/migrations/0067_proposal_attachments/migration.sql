CREATE TABLE "proposal_attachment" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "proposal_id" UUID NOT NULL,
  "filename" TEXT NOT NULL,
  "content_type" TEXT NOT NULL,
  "byte_size" INTEGER NOT NULL,
  "sha256" TEXT NOT NULL,
  "bytes" BYTEA NOT NULL,
  "uploaded_by_id" UUID NOT NULL,
  "sort_order" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "proposal_attachment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "proposal_attachment_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "proposal_attachment_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "proposal_attachment_proposal_id_filename_key" ON "proposal_attachment"("proposal_id", "filename");
CREATE INDEX "proposal_attachment_proposal_id_sort_order_idx" ON "proposal_attachment"("proposal_id", "sort_order");

-- New MCP tools must appear in a Try me plan. These staff-queue rows use the zero id so a
-- sandbox refuses them instead of attaching files to a proposal that is not there.
INSERT INTO "try_me_task_call" ("task_id", "seq", "tool_name", "arguments", "capture", "expect", "note") VALUES
  ('7d0f0007-0000-4000-8000-000000000003', 110, 'unw_list_proposal_attachments', '{"proposalId":"{zeroId}"}', '{}', 'refused', 'List proposal documents (no such proposal)'),
  ('7d0f0007-0000-4000-8000-000000000003', 111, 'unw_get_proposal_attachment', '{"proposalId":"{zeroId}","attachmentId":"{zeroId}"}', '{}', 'refused', 'Get a proposal document download path (no such proposal)'),
  ('7d0f0007-0000-4000-8000-000000000003', 112, 'unw_attach_proposal_document', '{"proposalId":"{zeroId}","filename":"notes.md","contentBase64":"IyBub3Rlcw=="}', '{}', 'refused', 'Attach a Markdown file (no such proposal)'),
  ('7d0f0007-0000-4000-8000-000000000003', 113, 'unw_upsert_proposal_document', '{"proposalId":"{zeroId}","filename":"notes.md","contentBase64":"IyBub3Rlcw=="}', '{}', 'refused', 'Upsert a proposal document (no such proposal)'),
  ('7d0f0007-0000-4000-8000-000000000003', 114, 'unw_replace_proposal_attachment', '{"proposalId":"{zeroId}","attachmentId":"{zeroId}","contentBase64":"IyBub3Rlcw=="}', '{}', 'refused', 'Replace a proposal document (no such attachment)'),
  ('7d0f0007-0000-4000-8000-000000000003', 115, 'unw_delete_proposal_attachment', '{"proposalId":"{zeroId}","attachmentId":"{zeroId}"}', '{}', 'refused', 'Delete a proposal document (no such attachment)'),
  ('7d0f0007-0000-4000-8000-000000000003', 116, 'unw_reorder_proposal_attachments', '{"proposalId":"{zeroId}","ids":["{zeroId}"]}', '{}', 'refused', 'Reorder proposal documents (no such proposal)'),
  ('7d0f0007-0000-4000-8000-000000000003', 117, 'unw_list_proposal_roles', '{"proposalId":"{zeroId}"}', '{}', 'refused', 'List proposal roles (no such proposal)'),
  ('7d0f0007-0000-4000-8000-000000000003', 118, 'unw_set_proposal_roles', '{"proposalId":"{zeroId}","roles":[]}', '{}', 'refused', 'Set proposal roles (no such proposal)')
ON CONFLICT DO NOTHING;

INSERT INTO "try_me_exercise_tool" ("exercise_code", "tool_name") VALUES
  ('variants', 'unw_list_proposal_attachments'),
  ('variants', 'unw_get_proposal_attachment'),
  ('variants', 'unw_attach_proposal_document'),
  ('variants', 'unw_upsert_proposal_document'),
  ('variants', 'unw_replace_proposal_attachment'),
  ('variants', 'unw_delete_proposal_attachment'),
  ('variants', 'unw_reorder_proposal_attachments')
ON CONFLICT DO NOTHING;
