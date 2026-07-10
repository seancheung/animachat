import { bad, handler, ok, type IdParams } from "@/lib/api";
import { deleteProvider, updateProvider } from "@/lib/store";

export const PATCH = handler(async (req: Request, { params }: IdParams) => {
  const { id } = await params;
  const updated = updateProvider(id, await req.json());
  return updated ? ok(updated) : bad("Provider not found", 404);
});

export const DELETE = handler(async (_req: Request, { params }: IdParams) => {
  deleteProvider((await params).id);
  return ok({ ok: true });
});
