# Prospect chat on a local LLM (Ollama + small Qwen)

Status: **plan, untested.** Nothing below has been run against this codebase with Ollama. No benchmarks are claimed; measure on the target machine before relying on any of it. `/chat` currently renders a "Coming soon" page (`ChatComingSoonPage` in `src/App.tsx`, gated by `prospectChatEnabled = false`).

## Why a small quantized Qwen, not a big Llama-class model

- Memory: weights need roughly `parameters x bits / 8` bytes plus KV cache. A 70B model at 4-bit is ~40 GB of weights alone, more than a typical single GPU or a small server's spare RAM. 8B-class at 4-bit is ~5 GB; 3B at 4-bit is ~2 GB (Ollama's `qwen2.5:7b` and `qwen2.5:3b` downloads are about 4.7 GB and 1.9 GB).
- Latency: on CPU or a modest GPU, big models give a few tokens per second at best (untested here), too slow for a chat turn.
- The task is narrow: pick one of five fixed engagements and fill a small JSON proposal, or escalate. That is a bounded classification/extraction job, which small instruct models handle acceptably when the prompt and context are tight.
- `qwen2.5:3b-instruct` / `qwen2.5:7b-instruct` support tool calling in Ollama, which `server/proposalAgent.ts` uses (`create_proposal`, `escalate`). Start with 7B; try 3B if latency or memory is a problem, and compare quality on the same test prompts.

## Install and pull

```sh
# Linux
curl -fsSL https://ollama.com/install.sh | sh
# Windows/macOS: installer from https://ollama.com/download

ollama pull qwen2.5:7b-instruct      # or qwen2.5:3b-instruct
ollama run qwen2.5:7b-instruct "Say ok"   # smoke test
```

Ollama listens on `http://localhost:11434`. Its OpenAI-compatible API is at **`http://localhost:11434/v1`** (`POST /v1/chat/completions`).

## What the chat server reads today

From `server/proposalAgent.ts` (`modelFromEnv`, `completeProposalTurn`), used by `server/routes/chatProposalRead.ts`:

| Env var | Default | Notes |
|---|---|---|
| `UNWH_MODEL_API_KEY` (or `MODEL_API_KEY`) | none | **Required**: if unset, no model is configured. Ollama ignores the key, so any non-secret placeholder (e.g. `ollama`) works. |
| `UNWH_MODEL_BASE_URL` | `https://api.x.ai/v1` | Set to `http://localhost:11434/v1`. Trailing `/` is stripped; the code appends `/chat/completions`. |
| `UNWH_MODEL_NAME` | `grok-4` | Set to `qwen2.5:7b-instruct`. |

So the code is already provider-neutral (OpenAI-compatible) and needs **no change to point at Ollama**:

```sh
UNWH_MODEL_BASE_URL=http://localhost:11434/v1
UNWH_MODEL_NAME=qwen2.5:7b-instruct
UNWH_MODEL_API_KEY=ollama
```

Set these in the server's environment (service config / secret store), not in a committed file. If the model call fails, `runProposalAgent` already escalates to a person.

## Proposed minimal code changes (not made)

The request body sends only `model`, `messages`, `tools`. For a small local model, add (in `completeProposalTurn`):

1. `temperature: Number(env.UNWH_MODEL_TEMPERATURE ?? 0.1)`; low temperature for stable engagement picks.
2. `max_tokens: Number(env.UNWH_MODEL_MAX_TOKENS ?? 400)`; a proposal JSON is short.
3. Timeout: `signal: AbortSignal.timeout(Number(env.UNWH_MODEL_TIMEOUT_MS ?? 20000))` on the `fetch`. On abort, the existing catch escalates.
4. Thread these through `modelFromEnv`'s return type so the defaults stay as they are for the hosted provider.

`num_ctx` is not settable through Ollama's OpenAI endpoint. Set it on the Ollama side, either with `OLLAMA_CONTEXT_LENGTH=4096` for the server or with a Modelfile:

```
FROM qwen2.5:7b-instruct
PARAMETER num_ctx 4096
PARAMETER temperature 0.1
```

`ollama create unwh-qwen -f Modelfile`, then `UNWH_MODEL_NAME=unwh-qwen`.

## Keep questions bounded (performance and accuracy)

- **Fixed intents.** The agent does one of three things: ask one clarifying question, call `create_proposal` with one of `workflow_check`, `capped_hours_4`, `capped_hours_8`, `fixed_price`, `hourly`, or call `escalate`. Everything else is a fallback to Contact.
- **Small injected context.** Inject only the prices and tiers from `shared/catalog-v1.json` (Workflow Check $250, Capped 4h $550, Capped 8h $900, Fixed from $3K, hourly $175) and the service-tier names. Don't inject whole pages or case studies.
- **Short system prompt.** Keep `PROPOSAL_SYSTEM_PROMPT` to the rules and prices; fewer input tokens means faster prompt processing on CPU/GPU.
- **JSON output.** Prefer the tool call; validate arguments server-side (already parsed and checked) and escalate on bad JSON.
- **Limit history.** Send the last few turns only, so the conversation stays well under `num_ctx`.
- **Low temperature, capped `max_tokens`, hard timeout** (above).
- **Fallback to Contact.** On timeout, error, invalid output or an off-topic request, reply with a link to `/contact` and escalate. Never let the model invent prices, dates or capabilities; prices come from the catalog.

## Before enabling `/chat`

- Run the API tests (`tests/api/chatProposalRead.test.ts`) and a manual set of prospect prompts against the local model; record latency and engagement accuracy on the real hardware (untested so far).
- Build the client chat UI, then set `prospectChatEnabled` (or replace the coming-soon page) in `src/App.tsx`.
