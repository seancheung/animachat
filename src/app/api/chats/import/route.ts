import { bad, handler, ok, tooLarge } from "@/lib/api";
import { importChatArchive } from "@/lib/chatArchive";

export const POST = handler(async (req: Request) => {
  if (tooLarge(req, 512 * 1024 * 1024)) return bad("archive too large (max 512MB)", 413);
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return bad("file field is required");
  try {
    const chat = await importChatArchive(Buffer.from(await file.arrayBuffer()));
    return ok({ chat });
  } catch (e) {
    // a garbage zip / foreign manifest is a client problem, not a server error
    return bad(e instanceof Error ? e.message : "not a readable archive");
  }
});
