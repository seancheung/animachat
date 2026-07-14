import { bad, handler, ok } from "@/lib/api";
import { importBundle, previewBundle } from "@/lib/bundle";

export const POST = handler(async (req: Request) => {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return bad("file field is required");
  const buf = Buffer.from(await file.arrayBuffer());
  // preview=1 lists the contents for the selection dialog without importing
  if (form.get("preview")) return ok(await previewBundle(buf));
  const selectedRaw = form.get("selected");
  let selected: string[] | undefined;
  if (typeof selectedRaw === "string") {
    const parsed = JSON.parse(selectedRaw);
    if (!Array.isArray(parsed) || !parsed.every((k) => typeof k === "string"))
      return bad("selected must be an array of type:id keys");
    selected = parsed;
  }
  const result = await importBundle(buf, selected);
  return ok(result);
});
