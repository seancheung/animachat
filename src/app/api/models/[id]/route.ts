import { bad, handler, ok, price, type IdParams } from "@/lib/api";
import { deleteModel, updateModel } from "@/lib/store";

export const PATCH = handler(async (req: Request, { params }: IdParams) => {
  const { id } = await params;
  const b = await req.json();
  if (typeof b.customBody === "string") {
    try {
      b.customBody = b.customBody.trim() ? JSON.parse(b.customBody) : null;
    } catch {
      return bad("custom request body is not valid JSON");
    }
  }
  for (const k of ["inputPrice", "cacheReadPrice", "cacheWritePrice", "outputPrice"] as const) {
    if (k in b) b[k] = price(b[k]);
  }
  const updated = await updateModel(id, b);
  return updated ? ok(updated) : bad("Model not found", 404);
});

export const DELETE = handler(async (_req: Request, { params }: IdParams) => {
  await deleteModel((await params).id);
  return ok({ ok: true });
});
