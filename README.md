# On-call Copilot Lite

A small AI assistant for debugging production incidents. Paste an alert or logs, chat with an AI about what might be wrong, and keep a list of hypotheses that the AI always takes into account.

**Live demo:** https://cf-ai-oncall-copilot.aashiagarwal0987.workers.dev

## What it does

- **One page per incident.** Open `/incident/<name>` (e.g. `/incident/db-latency`) or type a name on the home page. Each incident has its own chat history.
- **Chat about the incident.** Paste alerts, logs or observations and ask the AI for likely causes and what to check next.
- **Incident notes.** A side panel where you add hypotheses, mark them as *ruled out*, or delete them. The AI sees the current notes on every reply, so it won't keep suggesting things you've already checked.
- Everything is saved: reload the page, or open the same incident in another tab, and the chat and notes are still there.

## How it uses Cloudflare

| Piece | What it's used for |
|---|---|
| **LLM: Workers AI** | Llama 3.3 70B (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`), called through the `AI` binding with `workers-ai-provider` and the Vercel AI SDK. No external API key. |
| **Coordination: Durable Objects (Agents SDK)** | `IncidentAgent` (`src/server.ts`) extends `AIChatAgent`. Each incident name maps to its own Durable Object instance, so incidents are fully isolated and every tab on the same incident talks to the same instance. |
| **Chat input** | React UI (`src/app.tsx`) using `useAgent` + `useAgentChat`. Messages go over a WebSocket and the reply streams back token by token. |
| **Memory / state** | Chat history is stored in each Durable Object's built-in SQLite by `AIChatAgent`. Notes live in the agent's synced state (`this.setState`); the UI edits them via `@callable` methods (`addNote`, `setNoteStatus`, `deleteNote`) and every connected tab gets updates live. The notes are added to the system prompt on every turn. |

## Run locally

Requires Node.js and a Cloudflare account (Workers AI has no local emulator, so local dev calls the real model).

```bash
npm install
npx wrangler login   # once
npm run dev
```

Open http://localhost:5173 and type an incident name.

## Deploy

```bash
npm run deploy
```

This builds the frontend and runs `wrangler deploy`. After changing bindings in `wrangler.jsonc`, run `npm run types`.

## Bug we hit: doubled text

Early on, replies came out with every word doubled: *"LikLikely cause:ely cause: storage storage…"*.

**Cause:** Llama 3.3 on Workers AI sends each streamed token twice in the same chunk: once in the `response` field and once in the OpenAI-style `choices[0].delta.content`. `workers-ai-provider` (3.3.1, and still in 4.0.1) emits text for both fields. We confirmed this by logging the raw stream from the model, so it wasn't a UI problem.

**Fix:** `src/dedupe-ai-binding.ts` wraps the `AI` binding and removes the duplicate `response` field from chunks that already have `delta.content`, before the provider sees them. It does the same for duplicate `tool_calls`. Once the provider is fixed upstream, this file can be deleted.

## Future work

- Let the AI add and rule out notes itself through tool calls, if Llama 3.3 proves reliable enough at tool use.
- A list of recent incidents on the home page.
- Mark an incident as resolved and generate a short postmortem summary from the chat and notes.
- Authentication, so incidents aren't open to anyone with the URL.
