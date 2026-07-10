import { bad, handler, ok } from "@/lib/api";
import { importBundle } from "@/lib/bundle";

export const POST = handler(async (req: Request) => {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return bad("file field is required");
  const result = await importBundle(Buffer.from(await file.arrayBuffer()));
  return ok(result);
});
