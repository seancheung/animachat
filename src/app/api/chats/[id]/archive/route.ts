import { attachmentDisposition, bad, handler, type IdParams } from "@/lib/api";
import { exportChatArchive } from "@/lib/chatArchive";
import { getChat } from "@/lib/store";

export const GET = handler(async (_req: Request, { params }: IdParams) => {
  const { id } = await params;
  const chat = getChat(id);
  if (!chat) return bad("Chat not found", 404);
  const zip = await exportChatArchive(id);
  return new Response(new Uint8Array(zip), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": attachmentDisposition(chat.title, "chat.zip"),
    },
  });
});
