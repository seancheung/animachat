import { bad, handler, ok, type IdParams } from "@/lib/api";
import { createCheckpoint, getChat, getMessage, listCheckpoints } from "@/lib/store";

export const GET = handler(async (_req: Request, { params }: IdParams) =>
  ok(listCheckpoints((await params).id))
);

export const POST = handler(async (req: Request, { params }: IdParams) => {
  const { id } = await params;
  if (!getChat(id)) return bad("Chat not found", 404);
  const b = await req.json();
  const msg = b.messageId ? getMessage(b.messageId) : null;
  if (!msg || msg.chatId !== id) return bad("messageId must reference a message in this chat");
  return ok(createCheckpoint(id, msg.id, b.name || "Checkpoint"));
});
