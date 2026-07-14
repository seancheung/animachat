import { bad, handler, ok, type IdParams } from "@/lib/api";
import { buildContext } from "@/lib/ai/prompts";
import { tagMentions } from "@/lib/mentions";
import { appendMessage, getChat } from "@/lib/store";

/** Append a user message. (Scene progression, presence and endings are narrator-driven —
 *  there is no manual switching; stage state derives from narrator message events.) */
export const POST = handler(async (req: Request, { params }: IdParams) => {
  const { id } = await params;
  const chat = getChat(id);
  if (!chat) return bad("Chat not found", 404);
  const b = await req.json();
  if (typeof b.content !== "string" || !b.content.trim()) return bad("content required");
  const present = buildContext(id).present.map((c) => c.name);
  const msg = appendMessage({ chatId: id, role: "user", content: tagMentions(b.content.trim(), present) });
  return ok({ message: msg });
});
