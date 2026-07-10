import { bad, handler, ok, type IdParams } from "@/lib/api";
import { deleteModel, updateModel } from "@/lib/store";

export const PATCH = handler(async (req: Request, { params }: IdParams) => {
  const { id } = await params;
  const b = await req.json();
  if (typeof b.customBody === "string") {
    b.customBody = b.customBody.trim() ? JSON.parse(b.customBody) : null;
  }
  const updated = updateModel(id, b);
  return updated ? ok(updated) : bad("Model not found", 404);
});

export const DELETE = handler(async (_req: Request, { params }: IdParams) => {
  deleteModel((await params).id);
  return ok({ ok: true });
});
