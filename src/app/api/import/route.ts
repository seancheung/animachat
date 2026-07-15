import { bad, handler, ok, tooLarge } from "@/lib/api";
import { importBundle, previewBundle } from "@/lib/bundle";

export const POST = handler(async (req: Request) => {
  // bundles legitimately carry a whole library of art/BGM — the cap only bounds memory
  if (tooLarge(req, 512 * 1024 * 1024)) return bad("bundle too large (max 512MB)", 413);
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return bad("file field is required");
  const buf = Buffer.from(await file.arrayBuffer());
  try {
    // preview=1 lists the contents for the selection dialog without importing
    if (form.get("preview")) return ok(await previewBundle(buf));
    const selectedRaw = form.get("selected");
    let selected: string[] | undefined;
    if (typeof selectedRaw === "string") {
      let parsed: unknown;
      try {
        parsed = JSON.parse(selectedRaw);
      } catch {
        return bad("selected is not valid JSON");
      }
      if (!Array.isArray(parsed) || !parsed.every((k) => typeof k === "string"))
        return bad("selected must be an array of type:id keys");
      selected = parsed;
    }
    return ok(await importBundle(buf, selected));
  } catch (e) {
    // a garbage zip / foreign manifest is a client problem, not a server error
    return bad(e instanceof Error ? e.message : "not a readable bundle");
  }
});
