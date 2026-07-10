import { bad, handler, ok, type IdParams } from "@/lib/api";
import {
  appendMessage,
  createCheckpoint,
  deleteCheckpoint,
  getChat,
  getCheckpoint,
  getMessage,
  getSummary,
  invalidateSummary,
  listMessages,
  putSummary,
  saveChat,
  truncateMessages,
} from "@/lib/store";

/**
 * Load a save state. mode "truncate" rewinds this chat to the checkpoint;
 * mode "fork" copies the chat up to the checkpoint into a new chat.
 */
export const POST = handler(async (req: Request, { params }: IdParams) => {
  const { id } = await params;
  const cp = getCheckpoint(id);
  if (!cp) return bad("Checkpoint not found", 404);
  const anchor = getMessage(cp.messageId);
  if (!anchor) return bad("Checkpoint anchor message no longer exists", 410);
  const b = await req.json().catch(() => ({}));
  const mode = b.mode === "fork" ? "fork" : "truncate";

  if (mode === "truncate") {
    truncateMessages(cp.chatId, anchor.position);
    invalidateSummary(cp.chatId, anchor.position + 1);
    return ok({ chatId: cp.chatId });
  }

  const src = getChat(cp.chatId);
  if (!src) return bad("Chat not found", 404);
  const { id: _id, createdAt: _c, updatedAt: _u, ...fields } = src;
  const fork = saveChat({ ...fields, title: `${src.title} (fork)` });
  for (const m of listMessages(cp.chatId)) {
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
  const summary = getSummary(cp.chatId);
  if (summary.content && summary.coveredPosition <= anchor.position) {
    // fork positions are contiguous; remap coverage by counting copied messages
    const covered = listMessages(cp.chatId).filter(
      (m) => m.position <= anchor.position && m.position <= summary.coveredPosition
    ).length;
    putSummary(fork.id, summary.content, covered - 1);
  }
  const forkMsgs = listMessages(fork.id);
  const forkAnchor = forkMsgs[forkMsgs.length - 1];
  if (forkAnchor) createCheckpoint(fork.id, forkAnchor.id, cp.name);
  return ok({ chatId: fork.id });
});

export const DELETE = handler(async (_req: Request, { params }: IdParams) => {
  deleteCheckpoint((await params).id);
  return ok({ ok: true });
});
