-- Client tokens keep contracts:write so they can sign. #63 dropped it from the
-- client preset; this puts it back. The scope stays public in OAuth discovery
-- (oauth_scope.staff_only is unchanged). The API limits a client caller to
-- signing a contract they are a party to. Other contract writes stay staff-only.
-- Existing tokens keep the scopes they were minted with.
UPDATE "scope_preset"
SET "scopes" = ARRAY['proposals:read', 'proposals:write', 'contracts:write', 'billing:read', 'projects:read']
WHERE "code" = 'client';
