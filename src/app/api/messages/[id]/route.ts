import { bad, handler, ok, type IdParams } from "@/lib/api";
import { deleteMessage, getMessage, invalidateSummary, updateMessage } from "@/lib/store";

/**
 * In-place message editing (no branching): content/emotion edits modify the
 * active variant; activeVariant switches swipes; sceneEvent edits the metadata.
 */
export const PATCH = handler(async (req: Request, { params }: IdParams) => {
  const { id } = await params;
  const msg = getMessage(id);
  if (!msg) return bad("Message not found", 404);
  const b = await req.json();

  const variants = [...msg.variants];
  if (b.content !== undefined || b.emotion !== undefined || b.options !== undefined) {
    const idx = b.variantIndex ?? msg.activeVariant;
    const v = variants[idx];
    if (!v) return bad("variant not found");
    variants[idx] = {
      ...v,
      content: b.content !== undefined ? b.content : v.content,
      emotion: b.emotion !== undefined ? b.emotion : v.emotion,
      options: b.options !== undefined ? b.options : v.options,
    };
    invalidateSummary(msg.chatId, msg.position);
  }
  const updated = updateMessage(id, {
    variants,
    activeVariant: b.activeVariant,
    sceneEvent: b.sceneEvent,
  });
  return ok(updated);
});

export const DELETE = handler(async (_req: Request, { params }: IdParams) => {
  const { id } = await params;
  const msg = getMessage(id);
  if (!msg) return ok({ ok: true });
  invalidateSummary(msg.chatId, msg.position);
  deleteMessage(id);
  return ok({ ok: true });
});
