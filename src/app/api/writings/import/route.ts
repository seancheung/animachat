import { bad, handler, ok, tooLarge } from "@/lib/api";
import { upsertFiction } from "@/lib/store";

const MAX_IMPORT_BYTES = 20 * 1024 * 1024;

export const POST = handler(async (req: Request) => {
  if (tooLarge(req, MAX_IMPORT_BYTES)) return bad("writing export is too large", 413);
  const body = await req.json();
  if (body?.kind !== "animachat-writings") return bad("not an AnimaChat writings export file");
  if (body.version !== 1) return bad(`unsupported writings export version: ${body.version}`);
  if (!Array.isArray(body.writings)) return bad("writings must be an array");
  if (body.writings.length > 1000) return bad("too many writing projects");
  let imported = 0;
  for (const item of body.writings) {
    if (!item || typeof item !== "object" || typeof item.id !== "string" || !item.id)
      return bad("invalid fiction entry");
    await upsertFiction(item);
    imported++;
  }
  return ok({ imported });
});
