/**
 * Workaround for duplicated streamed text with Llama 3.3 on Workers AI.
 *
 * Each streamed SSE chunk from the model carries the same token twice: once
 * in the native `response` field and once in the OpenAI-style
 * `choices[0].delta.content`. workers-ai-provider (3.3.1, still in 4.0.1)
 * emits a text-delta for *both*, so every token shows up twice in the UI
 * ("LikLikely cause:ely cause:"). The same applies to top-level `tool_calls`
 * vs `choices[0].delta.tool_calls`.
 *
 * This wraps the AI binding so that, for streamed chunks that already contain
 * the OpenAI-style delta, the duplicate native fields are removed before the
 * provider sees them. Everything else passes through untouched.
 */
export function dedupeAiBinding(ai: Ai): Ai {
  return new Proxy(ai, {
    get(target, prop, receiver) {
      if (prop === "run") {
        return async (...args: Parameters<Ai["run"]>) => {
          const result = await (target.run as (...a: unknown[]) => unknown)(
            ...args
          );
          return result instanceof ReadableStream
            ? result.pipeThrough(dedupeSseStream())
            : result;
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}

function dedupeSseStream(): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  return new TransformStream({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? ""; // keep any partial trailing line
      if (lines.length > 0) {
        controller.enqueue(
          encoder.encode(lines.map(fixLine).join("\n") + "\n")
        );
      }
    },
    flush(controller) {
      buffer += decoder.decode();
      if (buffer) controller.enqueue(encoder.encode(fixLine(buffer)));
    }
  });
}

function fixLine(line: string): string {
  if (!line.startsWith("data:")) return line;
  const payload = line.slice(5).trim();
  if (!payload.startsWith("{")) return line; // e.g. [DONE]
  try {
    const event = JSON.parse(payload);
    const delta = event?.choices?.[0]?.delta;
    if (!delta) return line;
    let changed = false;
    if (typeof delta.content === "string" && "response" in event) {
      delete event.response;
      changed = true;
    }
    if (Array.isArray(delta.tool_calls) && "tool_calls" in event) {
      delete event.tool_calls;
      changed = true;
    }
    return changed ? `data: ${JSON.stringify(event)}` : line;
  } catch {
    return line;
  }
}
