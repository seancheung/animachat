import { bad, handler, ok, type IdParams } from "@/lib/api";
import { buildContext } from "@/lib/ai/prompts";
import { tagMentions } from "@/lib/mentions";
import { appendMessage, clampLimit, getChat, pageMessages } from "@/lib/store";

/** One keyset page of the timeline, NEWEST first — the client renders the tail and
 *  scrolls up for older pages. Stage/emotion metadata is NOT paged: the chat GET
 *  ships those projections whole (the fold needs every event, never the prose). */
export const GET = handler(async (req: Request, { params }: IdParams) => {
  const { id } = await params;
  if (!(await getChat(id))) return bad("Chat not found", 404);
  const sp = new URL(req.url).searchParams;
  return ok(await pageMessages(id, { limit: clampLimit(sp.get("limit")), cursor: sp.get("cursor") }));
});

/** Append a user message. (Scene progression, presence and endings are narrator-driven —
 *  there is no manual switching; stage state derives from narrator message events.) */
export const POST = handler(async (req: Request, { params }: IdParams) => {
  const { id } = await params;
  const chat = await getChat(id);
  if (!chat) return bad("Chat not found", 404);
  const b = await req.json();
  if (typeof b.content !== "string" || !b.content.trim()) return bad("content required");
  const present = (await buildContext(id)).present.map((c) => c.name);
  // playing as narrator, the user's messages ARE narrator messages (same rule as
  // the generate route's append)
  const msg = await appendMessage({
    chatId: id,
    role: chat.playAsNarrator ? "narrator" : "user",
    content: tagMentions(b.content.trim(), present),
  });
  return ok({ message: msg });
});
