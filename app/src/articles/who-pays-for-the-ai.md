---
title: "Who Pays for the AI? Four Ways to Add AI to Your Business"
author: UnwhelmNet
date: 2026-10-21
---

# Who Pays for the AI? Four Ways to Add AI to Your Business

Before "which model?", ask: **who pays each time someone uses the AI?** That sets your cost, its predictability and who keeps the data. There are four answers; most businesses use several.

## The four quadrants

Two questions sort them: who pays, and is the bill metered or flat?

| | **Your business pays** | **Someone else pays** |
|---|---|---|
| **Metered** | **1. Pay per use:** your API key, billed per token | **3. Vendor bundle:** vendor pays per token, you pay per seat |
| **Flat** | **2. Run your own model:** you pay for GPUs | **4. Bring your own client:** the user's monthly AI plan |

## 1. Pay per use (API keys)

The oldest option: anyone can get a key, and it works with any app. Cost varies per user. Enterprise deals can add [negotiated volume discounts](https://platform.claude.com/docs/en/about-claude/pricing#volume-discounts) and [volume commitments](https://claude.com/solutions/enterprise), not unlimited use. Every major provider lists 50% off for batch jobs and up to 90–95% off cached input; enterprise discounts are negotiated case by case. [Vendr's buyer data](https://vendr.com/marketplace/anthropic) shows commitments above about $25K a month often getting 15–30% off list.

| Model | Input / 1M tokens | Output / 1M tokens |
|---|---|---|
| [OpenAI gpt-6.1-sol](https://platform.openai.com/docs/pricing) | $2.00 | $10.00 |
| [OpenAI gpt-6-luna](https://platform.openai.com/docs/pricing) | $0.10 | $0.50 |
| [Claude Sonnet 5.5](https://docs.anthropic.com/en/docs/about-claude/pricing) | $2.00 | $10.00 |
| [Claude Haiku 5.5](https://docs.anthropic.com/en/docs/about-claude/pricing) (prompts ≤100K) | $0.10 | $0.50 |

Architecture matters more than token price. Your code can run the workflow and ask **bounded questions** at decision points, or an **agent can run everything**, making each use an open-ended bill.

*Example math (assumed token counts, list prices):*

| Approach | Tokens per task | Model | Per task | 40 tasks/month |
|---|---|---|---|---|
| Bounded question | 2,000 in / 200 out | Haiku 5.5 | ≈ $0.0003 | ≈ $0.01 |
| Bounded question | 2,000 in / 200 out | Sonnet 5.5 | ≈ $0.006 | ≈ $0.24 |
| Agent runs it | 30 steps × (20,000 in / 1,000 out) | Sonnet 5.5 | ≈ $1.50 | ≈ $60 |

Controls: per-user caps, cheaper models for simple steps, [prompt caching](https://docs.anthropic.com/en/docs/about-claude/pricing), and batch discounts ([Anthropic](https://docs.anthropic.com/en/docs/about-claude/pricing), [OpenAI](https://platform.openai.com/docs/pricing)). See [AI economics](/services/ai/economics).

## 2. Run your own model

Open-weight models (Llama, Mistral, Qwen; check each license) on your own or rented GPUs. *Example:* an [H100 PCIe at $2.89/hr](https://www.runpod.io/pricing) all month ≈ **$2,080**, at any volume. Fixed cost, private data; usually below frontier quality, and you run it. Best for high-volume, narrow tasks. See [AI solutions](/services/ai).

## 3. Vendor bundle

AI inside software you already pay for: Realm-X in [AppFolio](https://www.appfolio.com/pricing) plans (Core: $1.49/unit/month; 50-unit minimum and minimum spend apply), or [Microsoft 365 Copilot Business](https://www.microsoft.com/en-us/copilot/pricing/business) at $21 per user, per month (billed yearly, so about $252 per person per year; $25.20/month if paid monthly; discounted to $18 through Dec 31, 2026). That's on top of your Microsoft 365 licenses, so a 20-person team adds about $420 a month. Enterprise Microsoft 365 Copilot is about $30 per user. Predictable, nothing to build; limited to what the vendor built.

## 4. Bring your own client (MCP): the newest

You publish an MCP server, a toolset any capable AI assistant can use. The user's assistant does the reasoning on their plan. You pay no tokens, just servers, auth and abuse protection, and users keep their history.

Unlike API keys, this is early: few clients connect, often only on certain plans:

| Client | Custom remote MCP today |
|---|---|
| [Claude](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp) | Free (one custom connector), [Pro $20/mo, or $17/mo billed annually on the web](https://claude.com/pricing), Max, Team, Enterprise |
| [ChatGPT](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt) | OpenAI's docs reserve full MCP (incl. writes) for Business/Enterprise/Edu and list read/fetch on Pro. In our testing it also works on Plus, as a personal plugin in ChatGPT on the web and in Codex. |
| [Gemini](https://support.google.com/gemini/answer/17209137) | [Rolling out](https://support.google.com/gemini/answer/17171264) on [Google AI Pro ($19.99/mo)](https://one.google.com/about/google-ai-plans/); US, 18+, English, personal accounts |
| [Grok](https://docs.x.ai/grok/connectors) | All Grok users, at grok.com/connectors; admins add them first on Business/Enterprise |
| [Mistral Vibe](https://docs.mistral.ai/vibe/work/connectors/mcp-connectors) ([formerly Le Chat](https://mistral.ai/news/vibe-agent/)) | Free and paid plans (the account owner adds them); [Pro $14.99/mo](https://mistral.ai/pricing/) |

Support will widen ([AppFolio now offers a Claude connector](https://www.appfolio.com/newsroom/appfolio-introduces-the-new-realm-x)). Don't make prospects buy a plan to browse: pair a free, capped site chat with bring-your-own-client for real work. See [AI agents](/services/ai/agents).

## Side by side

| | 1. Pay per use | 2. Own model | 3. Vendor bundle | 4. Bring your own client |
|---|---|---|---|---|
| **Who pays for AI** | You, per token | You, for GPUs | Vendor, in your seat fee | User, on their plan |
| **Predictability** | Low | High | High | High; no token bill |
| **Setup** | API + guardrails | Most: hosting, ops | Least | MCP server, auth, limits |
| **Data** | Passes through provider | Stays with you | Vendor's platform | User keeps history |
| **Best for** | Bounded questions in your workflows | High-volume, narrow, private | Standard work in one tool | Clients doing ongoing work |

## Where are you today?

Each "yes" is a quadrant. Several is normal, often smart.

| Do you have… | Quadrant |
|---|---|
| An API key billed to your company card? | 1 |
| GPUs you rent or own to run a model? | 2 |
| An "AI" button in software you pay for per seat? | 3 |
| Clients connecting their own ChatGPT or Claude to your data? | 4 |

Only in 1? Try bounded questions first.

## The short version

API keys are the oldest and work with anything, but you pay every time. Bring-your-own-client is the newest and still limited, but costs you no tokens.

## Where Unwhelm fits

Done some of this with AI yourself? Great. It's like bringing your own parts to a mechanic: most firms say "don't, we're the specialists." We welcome self-service. Do 10%, do 90%, it doesn't matter to us. We pick up where you left off and help with the questions you might not know to ask: which quadrants, real costs, tradeoffs.

Clients get a [free AI agent setup](/services/agent-setup) on their own plan. Book a free 30-minute consult or the [$250 Workflow Check](/pricing). No pressure.
