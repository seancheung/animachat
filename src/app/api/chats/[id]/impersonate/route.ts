import { bad, handler, type IdParams } from "@/lib/api";
import { AiConfigError, resolveModel, streamLlm } from "@/lib/ai/client";
import { buildContext, buildImpersonateRequest } from "@/lib/ai/prompts";
import { getChat } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Draft the user's next reply in their persona's voice, streamed into their input box.
 *  Aborting keeps whatever was written — a half-draft is still a starting point. */
export const POST = handler(async (req: Request, { params }: IdParams) => {
  const { id } = await params;
  if (!(await getChat(id))) return bad("Chat not found", 404);
  const ctx = await buildContext(id);

  let built;
  let modelRef;
  try {
    modelRef = await resolveModel("impersonate", ctx.chat);
    built = await buildImpersonateRequest(ctx, modelRef);
  } catch (e) {
    return bad(e instanceof Error ? e.message : String(e), e instanceof AiConfigError ? 409 : 500);
  }

  const encoder = new TextEncoder();
  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort());
  if (req.signal.aborted) abort.abort(); // listener-after-abort never fires

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          /* client disconnected */
        }
      };
      try {
        for await (const ev of streamLlm({
          modelRef,
          system: built.system,
          messages: built.messages,
          maxTokens: 400,
          feature: "impersonate",
          chatId: id,
          signal: abort.signal,
        })) {
          if (ev.type === "text") send({ type: "text", text: ev.text });
        }
      } catch (e) {
        if (!abort.signal.aborted) send({ type: "error", message: e instanceof Error ? e.message : String(e) });
      }
      try {
        controller.close();
      } catch {
        /* already closed */
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
});
