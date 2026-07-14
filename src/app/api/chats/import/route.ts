import { bad, handler, ok } from "@/lib/api";
import { importChatArchive } from "@/lib/chatArchive";

export const POST = handler(async (req: Request) => {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return bad("file field is required");
  const chat = await importChatArchive(Buffer.from(await file.arrayBuffer()));
  return ok({ chat });
});
