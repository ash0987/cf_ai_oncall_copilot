import { createWorkersAI } from "workers-ai-provider";
import { callable, routeAgentRequest, type Connection } from "agents";
import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import { dedupeAiBinding } from "./dedupe-ai-binding";
import { convertToModelMessages, pruneMessages, streamText } from "ai";

export type NoteStatus = "open" | "ruled_out";

export interface Note {
  id: string;
  text: string;
  status: NoteStatus;
  createdAt: string;
}

export interface IncidentState {
  notes: Note[];
}

// Keep the notes block in the prompt bounded
const MAX_NOTES = 50;
const MAX_NOTE_LENGTH = 500;

const BASE_PROMPT = `You are an on-call incident assistant helping an engineer debug a production incident. The engineer will paste alerts, logs and observations. Be concise and concrete: suggest likely causes, what to check next, and how to confirm or rule out each hypothesis.`;

function notesPrompt(notes: Note[]): string {
  const open = notes.filter((n) => n.status === "open");
  const ruledOut = notes.filter((n) => n.status === "ruled_out");
  const list = (items: Note[]) =>
    items.length ? items.map((n) => `- ${n.text}`).join("\n") : "- (none)";

  return `## Incident notes (maintained by the engineer, always current)
Open hypotheses (still being investigated):
${list(open)}

Ruled out (already checked and NOT the cause):
${list(ruledOut)}

Rules for using these notes:
- Never suggest a ruled-out item as a likely cause again. You may mention it only to say it was already ruled out.
- Prioritise helping confirm or rule out the open hypotheses.
- When suggesting new causes, prefer ones not already in the notes.
- These notes are newer than the chat history: if they conflict, trust the notes.`;
}

export class IncidentAgent extends AIChatAgent<Env, IncidentState> {
  maxPersistedMessages = 100;
  chatRecovery = true;
  initialState: IncidentState = { notes: [] };

  // State is only changed through the callable methods below,
  // so reject any direct setState() coming from a browser.
  validateStateChange(_next: IncidentState, source: Connection | "server") {
    if (source !== "server") {
      throw new Error(
        "Notes can only be changed via addNote/setNoteStatus/deleteNote"
      );
    }
  }

  @callable()
  addNote(text: string) {
    const clean = String(text ?? "")
      .trim()
      .slice(0, MAX_NOTE_LENGTH);
    if (!clean) throw new Error("Note text is empty");
    if (this.state.notes.length >= MAX_NOTES) {
      throw new Error(`An incident can have at most ${MAX_NOTES} notes`);
    }
    const note: Note = {
      id: crypto.randomUUID(),
      text: clean,
      status: "open",
      createdAt: new Date().toISOString()
    };
    this.setState({ notes: [...this.state.notes, note] });
    return note;
  }

  @callable()
  setNoteStatus(id: string, status: NoteStatus) {
    if (status !== "open" && status !== "ruled_out") {
      throw new Error(`Invalid status: ${status}`);
    }
    this.setState({
      notes: this.state.notes.map((n) => (n.id === id ? { ...n, status } : n))
    });
  }

  @callable()
  deleteNote(id: string) {
    this.setState({ notes: this.state.notes.filter((n) => n.id !== id) });
  }

  async onChatMessage(_onFinish: unknown, options?: OnChatMessageOptions) {
    // Wrapped to stop Llama 3.3 tokens being emitted twice (see dedupe-ai-binding.ts)
    const workersai = createWorkersAI({
      binding: dedupeAiBinding(this.env.AI)
    });

    const result = streamText({
      model: workersai("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
        sessionAffinity: this.sessionAffinity
      }),
      // Rebuilt every turn so the model always sees the latest notes
      system: `${BASE_PROMPT}\n\n${notesPrompt(this.state.notes)}`,
      // Prune old tool calls and reasoning to save tokens on long conversations
      messages: pruneMessages({
        messages: await convertToModelMessages(this.messages),
        toolCalls: "before-last-2-messages",
        reasoning: "before-last-message"
      }),
      abortSignal: options?.abortSignal
    });

    return result.toUIMessageStreamResponse();
  }
}

export default {
  async fetch(request: Request, env: Env) {
    return (
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  }
} satisfies ExportedHandler<Env>;
