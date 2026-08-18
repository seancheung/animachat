import { bad, handler, ok, tooLarge } from "@/lib/api";
import { upsertManuscript } from "@/lib/store";

const MAX_IMPORT_BYTES = 20 * 1024 * 1024;

export const POST = handler(async (req: Request) => {
  if (tooLarge(req, MAX_IMPORT_BYTES)) return bad("manuscript export is too large", 413);
  const body = await req.json();
  if (body?.kind !== "animachat-manuscripts") return bad("not an AnimaChat manuscript export file");
  if (body.version !== 1) return bad(`unsupported manuscript export version: ${body.version}`);
  if (!Array.isArray(body.manuscripts)) return bad("manuscripts must be an array");
  if (body.manuscripts.length > 1000) return bad("too many manuscripts");
  let imported = 0;
  for (const item of body.manuscripts) {
    if (!item || typeof item !== "object" || typeof item.id !== "string" || !item.id)
      return bad("invalid manuscript entry");
    await upsertManuscript(item);
    imported++;
  }
  return ok({ imported });
});
