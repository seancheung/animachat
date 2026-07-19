import { bad, handler, ok, type IdParams } from "@/lib/api";
import {
  appendMessage,
  getChat,
  getMessage,
  getSummary,
  inTransaction,
  listMessages,
  listStoryBonds,
  putStoryBonds,
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
  const src = await getChat(id);
  if (!src) return bad("Chat not found", 404);
  const b = await req.json().catch(() => ({}));
  const anchor = b.messageId ? await getMessage(b.messageId) : null;
  if (!anchor || anchor.chatId !== id) return bad("messageId must reference a message in this chat");

  // atomic: a mid-copy failure must not leave a half-forked chat behind
  const fork = await inTransaction(async () => {
    const { id: _id, createdAt: _c, updatedAt: _u, ...fields } = src;
    const created = await saveChat({ ...fields, title: `${src.title} (fork)` });
    for (const m of await listMessages(id)) {
      if (m.position > anchor.position) break;
      const v = m.variants[m.activeVariant];
      await appendMessage({
        chatId: created.id,
        role: m.role,
        characterId: m.characterId,
        content: v?.content ?? "",
        emotion: v?.emotion ?? null,
        options: v?.options ?? null,
        sceneEvent: m.sceneEvent,
      });
    }
    const summary = await getSummary(id);
    if (summary.content && summary.coveredPosition <= anchor.position) {
      // fork positions are contiguous; remap coverage by counting copied messages
      const covered = (await listMessages(id)).filter(
        (m) => m.position <= anchor.position && m.position <= summary.coveredPosition
      ).length;
      await putSummary(created.id, summary.content, covered - 1);
      // story-local bonds are written only from summarized chunks, so they describe
      // history up to the summary's coverage — valid for the fork exactly when the
      // summary itself carries (truncated-away history must not leak in as feelings)
      for (const rec of await listStoryBonds(id)) {
        if (rec.bonds.length) await putStoryBonds(created.id, rec.characterId, rec.bonds);
      }
    }
    return created;
  });
  return ok({ chatId: fork.id });
});
