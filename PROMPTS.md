# Prompts

The prompts I sent to Claude Code (Claude Opus 5.5) while building this project, in order, each with a one-line note on what came out of it.

The full chat export, including Claude's replies and every tool call, is in [`prompts/claude-code-session.txt`](prompts/claude-code-session.txt).

---

### 1. Understand the starter and plan

> I'm building a small AI app.
> Requirements:
> an LLM (Llama 3.3 on Workers AI),
> coordination (Durable Objects via the Agents SDK),
> chat input, and memory/state.
> This repo is Cloudflare's agents starter. I've already switched the model to @cf/meta/llama-3.3-70b-instruct-fp8-fast. First read AGENTS.md, src/server.ts and the frontend code, and explain briefly how the starter works: where the agent class is, how chat messages flow, and where state is stored.
> Then propose a minimal plan to turn it into "On-call Copilot Lite": an engineer pastes an alert or logs and chats with an AI about the incident. Each incident is its own agent instance, chosen by an id in the URL (for example /incident/db-latency). The agent remembers chat history plus a short list of incident notes (hypotheses marked open or ruled out), which are always included in the LLM's context.
> One known issues to include in the plan: (1) the starter's demo tools (weather, timezone, scheduling) should be removed.
> Don't write code yet. Give me the plan as a short list of changes by file, and flag anything you're unsure is current in the Agents SDK.

**Result:** An explanation of how the starter works, a file-by-file plan, and a list of Agents SDK APIs to double-check against the docs.

### 2. Adjust the plan and start the cleanup

> Looks good overall, just a few tweaks before you start.
>
> Nothing's deployed yet, so you can edit the v1 migration directly. No need for a rename migration.
>
> Let's skip the separate "paste alert" box. Whatever someone sends first in an incident can just be treated as the alert.
>
> For notes, I'd rather start simple: make them editable from the UI first, using callable methods and state. Getting Llama to manage notes through tool calls can come later as an extra, and only if it actually works reliably. I don't want to depend on it.
>
> And yes, go ahead and remove MCP, the demo tools, the scheduling stuff and image attachments. We don't need any of that.
>
> Check the docs like you said, then let's do this in small steps. Stop after each one so I can test it and commit:
>
> First, clean up: remove the demo tools, MCP, scheduling and attachments.
> Then, incident routing by URL id, and rename the agent to IncidentAgent.
> Then, the notes state and sidebar, and make sure the notes go into the system prompt.
> Finally, if we have time, let the model update notes itself through tools.
>
> Let's start with the cleanup.

**Result:** The demo tools, MCP, scheduling and image attachments were removed, and the system prompt and example prompts became incident-focused.

### 3. Fix the doubled text

> The replies are coming out with doubled text. Words and phrases repeat, like "LikLikely cause:ely cause: Storage Storage partition partition…". . Can we fix this before doing routing?
> Please find the actual root cause instead of patching the symptom. My guess is it's either the Workers AI provider emitting each chunk twice (maybe it reads both the raw response field and an OpenAI-style delta from Llama's stream), or something on the UI side like React StrictMode or the message renderer appending deltas twice. Check the server stream first, for example by logging the raw chunks coming back from the model, so we know which side it's on.
> Once you know, explain the cause in a couple of lines, fix it, and tell me how to verify.

**Result:** Logging the raw stream showed that each Llama chunk carries the same text in both `response` and `delta.content`, and `workers-ai-provider` emits both. `src/dedupe-ai-binding.ts` fixes it at the binding level.

### 4. Incident routing and the IncidentAgent rename

> Tested it, the replies look normal now. .
> Now next: each incident should have its own page at /incident/<name> with its own separate chat history. On the home page, give me a simple box to type an incident name and open it. Also rename the agent to IncidentAgent. When it's done, tell me how to check that two incidents don't share history.

**Result:** Each incident gets its own `/incident/<name>` page backed by its own Durable Object, the home page got an "open incident" box, and the agent became `IncidentAgent`. Isolation between incidents was verified.

### 5. Incident notes

> tested it, both incidents keep their own chats. committed and deployed too
>
> now the notes part. for each incident i want a small side panel with notes, basically the things we think might be causing the issue. i should be able to add a note, mark it as ruled out, and delete it. and the AI should always see these notes when it replies, so it knows what we already checked and doesnt suggest the same thing again
>
> keep it simple, just me editing the notes for now. tell me how to test it after

**Result:** A notes side panel backed by agent state and `@callable` methods (add, rule out or reopen, delete) that syncs live across tabs. The notes are injected into the system prompt on every reply.

### 6. README

> ok notes work.
> can you write the readme now. what the app does, how it uses cloudflare (llm, durable objects, chat, memory), how to run it locally and deploy, and put the live link https://cf-ai-oncall-copilot.aashiagarwal0987.workers.dev
> also add a small part about the double text bug and how we fixed it, and some future work. keep it short and simple

**Result:** A new `README.md` covering what the app does, the Cloudflare pieces, local dev and deploy, the double-text bug and future work.

### 7. This file

> can you make a PROMPTS.md with all the prompts i sent you in this session, in order, with one line under each saying what came out of it. also mention at the top that the full chat export is in prompts

**Result:** This `PROMPTS.md`.
