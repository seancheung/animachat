import { attachmentDisposition, bad, handler, safeFilename, type IdParams } from "@/lib/api";
import { AiConfigError, callLlm, resolveModel, type ResolvedModel } from "@/lib/ai/client";
import { buildContext, type ChatContext } from "@/lib/ai/prompts";
import {
  buildNovelizeSystem,
  chunkByTokens,
  novelizeUserMessage,
  splitChapters,
  toEpub,
  toMarkdown,
  transcriptForModel,
  transcriptMd,
  type NovelVoice,
} from "@/lib/novel";
import { getChat, listMessages } from "@/lib/store";

export const dynamic = "force-dynamic";

/** ~tokens of transcript per rewrite call; chapters larger than this go in parts */
const CHUNK_TOKENS = 3500;
/** rewritten prose is roughly transcript-sized; generous headroom on top */
const REWRITE_MAX_TOKENS = 6000;
/** rewritten tail resent with the next chunk for continuity */
const TAIL_CHARS = 600;

/** Plain transcript export (instant, no AI). */
export const GET = handler(async (req: Request, { params }: IdParams) => {
  const { id } = await params;
  const chat = await getChat(id);
  if (!chat) return bad("Chat not found", 404);
  const format = new URL(req.url).searchParams.get("format") === "epub" ? "epub" : "md";
  const md = await toMarkdown(chat, await listMessages(chat.id));
  if (format === "md") {
    return new Response(md, {
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "content-disposition": attachmentDisposition(chat.title, "md"),
      },
    });
  }
  const epub = await toEpub(chat, md);
  return new Response(new Uint8Array(epub), {
    headers: {
      "content-type": "application/epub+zip",
      "content-disposition": attachmentDisposition(chat.title, "epub"),
    },
  });
});

interface RewriteBody {
  format?: "md" | "epub";
  /** narrative voice: third-person past (default) or first person from the persona */
  voice?: NovelVoice;
}

/**
 * AI-rewrite export: the `novelize` task model turns the transcript into novel prose,
 * chapter by chapter (scene advances are the chapter boundaries). SSE: `progress` per
 * rewrite call, `notice` when a part falls back to the plain transcript (fail-soft),
 * then one `done` carrying the finished file (epub as base64). Closing the connection aborts.
 */
export const POST = handler(async (req: Request, { params }: IdParams) => {
  const { id } = await params;
  const chat = await getChat(id);
  if (!chat) return bad("Chat not found", 404);
  const body = (await req.json().catch(() => ({}))) as RewriteBody;
  const format = body.format === "epub" ? "epub" : "md";
  const voice: NovelVoice = body.voice === "first" ? "first" : "third";

  let ctx: ChatContext;
  let modelRef: ResolvedModel;
  try {
    ctx = await buildContext(id);
    modelRef = await resolveModel("novelize", chat);
  } catch (e) {
    return bad(e instanceof Error ? e.message : String(e), e instanceof AiConfigError ? 409 : 400);
  }

  const chapters = await splitChapters(chat, ctx.messages);
  const system = buildNovelizeSystem(ctx, voice);
  const encoder = new TextEncoder();
  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort());

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          /* client disconnected — the abort signal ends the loop */
        }
      };

      const lines: string[] = [`# ${chat.title}`, ""];
      let tail = "";
      for (let i = 0; i < chapters.length && !abort.signal.aborted; i++) {
        const ch = chapters[i];
        if (ch.title) lines.push(`---`, "", `## ${ch.title}`, "");
        const parts = chunkByTokens(ch.messages, CHUNK_TOKENS);
        for (let p = 0; p < parts.length && !abort.signal.aborted; p++) {
          send({
            type: "progress",
            chapter: i + 1,
            total: chapters.length,
            title: ch.title,
            part: p + 1,
            parts: parts.length,
          });
          try {
            const prose = (
              await callLlm({
                modelRef,
                system,
                messages: [
                  { role: "user", content: novelizeUserMessage(tail, await transcriptForModel(chat, parts[p])) },
                ],
                maxTokens: REWRITE_MAX_TOKENS,
                feature: "novelize",
                chatId: id,
                signal: abort.signal,
              })
            ).trim();
            if (!prose) throw new Error("the model returned nothing");
            lines.push(prose, "");
            tail = prose.slice(-TAIL_CHARS);
          } catch (e) {
            if (abort.signal.aborted) break;
            // fail-soft: this part keeps the plain transcript rendering instead
            send({ type: "notice", message: e instanceof Error ? e.message : String(e) });
            lines.push(...(await transcriptMd(chat, parts[p])));
          }
        }
      }

      if (!abort.signal.aborted) {
        const md = lines.join("\n");
        const name = safeFilename(chat.title);
        if (format === "md") send({ type: "done", format, filename: `${name}.md`, data: md });
        else
          send({
            type: "done",
            format,
            filename: `${name}.epub`,
            data: (await toEpub(chat, md)).toString("base64"),
          });
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
