import { bad, handler, ok, type IdParams } from "@/lib/api";
import {
  appendMessage,
  getChat,
  getMessage,
  getSummary,
  listMessages,
  putSummary,
  saveChat,
} from "@/lib/store";

/**
 * Fork a chat at a message: a NEW chat copies all settings and every message up to
 * (and including) the anchor — each message's active variant, with its stage events —
 * and the rolling summary when it covers the copied range. Non-destructive: the source
 * chat is untouched (VN-style "loading a save" is simply returning to a fork).
 */
export const POST = handler(async (req: Request, { params }: IdParams) => {
  const { id } = await params;
  const src = getChat(id);
  if (!src) return bad("Chat not found", 404);
  const b = await req.json().catch(() => ({}));
  const anchor = b.messageId ? getMessage(b.messageId) : null;
  if (!anchor || anchor.chatId !== id) return bad("messageId must reference a message in this chat");

  const { id: _id, createdAt: _c, updatedAt: _u, ...fields } = src;
  const fork = saveChat({ ...fields, title: `${src.title} (fork)` });
  for (const m of listMessages(id)) {
    if (m.position > anchor.position) break;
    const v = m.variants[m.activeVariant];
    appendMessage({
      chatId: fork.id,
      role: m.role,
      characterId: m.characterId,
      content: v?.content ?? "",
      emotion: v?.emotion ?? null,
      options: v?.options ?? null,
      sceneEvent: m.sceneEvent,
    });
  }
  const summary = getSummary(id);
  if (summary.content && summary.coveredPosition <= anchor.position) {
    // fork positions are contiguous; remap coverage by counting copied messages
    const covered = listMessages(id).filter(
      (m) => m.position <= anchor.position && m.position <= summary.coveredPosition
    ).length;
    putSummary(fork.id, summary.content, covered - 1);
  }
  return ok({ chatId: fork.id });
});
