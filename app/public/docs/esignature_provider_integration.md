# E-signature provider integration notes (DocuSign / provider-neutral)

Unwhelm currently supports **built-in signing** via the client portal (review → download PDF → sign). This produces a signed contract record in Unwhelm (status + signed timestamp) and, depending on catalog policy, may generate the first invoice when signing is completed.

Unwhelm **does not** ship with DocuSign (or any other external e-signature provider) configured by default. Optional hosted signing is **SignWell or PandaDoc**, selected with `UNWH_ESIGN_PROVIDER=signwell` or `UNWH_ESIGN_PROVIDER=pandadoc` (one at a time). SignWell needs `SIGNWELL_API_KEY` and `SIGNWELL_WEBHOOK_SECRET`; PandaDoc needs `PANDADOC_API_KEY` and `PANDADOC_WEBHOOK_SECRET`. Set `UNWH_ESIGN_LIVE=1` only for production keys. The notes below describe how an external provider would connect once a provider account and credentials are set up by your team.

## What Unwhelm is responsible for

- **Authoritative terms/pricing**: The contract content is derived from Unwhelm’s locked/approved proposal version and contract rows. An export must not modify terms or pricing.
- **PDF generation**: Unwhelm generates the proposal/contract PDFs for review and archival.
- **Signing state and audit metadata**: Unwhelm stores contract status (`draft`/`sent`/`signed`/`cancelled`) and `signedAt` when signing is completed.
- **Idempotent billing semantics**: When the contract is signed, Unwhelm may create the signing invoice depending on catalog policy; repeated completion events must stay idempotent.

## What an external provider is responsible for

- **Envelope/session experience**: Presenting the contract to signers, collecting signatures, and enforcing identity/consent workflows.
- **Signer routing**: Supporting multiple signers and routing order (if desired).
- **Delivery guarantees**: Retrying webhooks and providing event logs.
- **Completed artifact**: Providing the final signed PDF and certificate of completion.

## Integration shape (provider-neutral)

### 1) Create an envelope / signature request

Triggered when a contract is ready to sign (typically after client acceptance).

- **Input**: Unwhelm contract id, organization id, and the contract PDF bytes.
- **Provider call**: Create an envelope (DocuSign) / agreement (Adobe Sign) / signature request (Dropbox Sign).
- **Store**: Provider envelope id, provider name, and current provider status on the Unwhelm contract (or a linked `contract_signature` table if introduced later).

### 2) Present the signing experience

Two common patterns:

- **Provider-hosted email**: Provider sends signers a link; Unwhelm shows “Sent to signer(s)” and polls/status-updates by webhook.
- **Embedded signing**: Unwhelm requests an embedded signing URL from the provider and opens it in a new tab/frame; Unwhelm still relies on webhooks for completion.

### 3) Receive status updates via webhooks

Configure a provider webhook endpoint (server-to-server).

- **Verification**: Validate the provider signature/HMAC and reject unknown tenants.
- **Tenant isolation**: Resolve envelope id → contract id → organization id and ensure cross-tenant events cannot be applied.
- **Idempotency**: Persist a provider event id / delivery id and treat repeats as no-ops.

### 4) Completion responsibilities

On a provider “completed” event:

- **Fetch completed PDF**: Download the signed PDF + certificate if the provider supplies it.
- **Persist artifacts**: Store or attach the signed PDF in your storage layer (S3/GCS/etc) and record the storage pointer in Unwhelm.
- **Mark signed**: Transition Unwhelm contract status to `signed` and set `signedAt` once.
- **Trigger billing**: Call the existing Unwhelm signing semantics (the same behavior as built-in signing) exactly once.

## Required configuration (not included)

- Provider account + API keys / OAuth app
- Webhook endpoint URL, verification secret/cert configuration, and allowed outbound IPs (if applicable)
- Mapping rules for which Unwhelm contracts use external signing vs built-in signing

