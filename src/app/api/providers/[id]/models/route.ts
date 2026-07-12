import { bad, handler, ok, price, type IdParams } from "@/lib/api";
import { createModel, getProvider } from "@/lib/store";

export const POST = handler(async (req: Request, { params }: IdParams) => {
  const { id } = await params;
  if (!getProvider(id)) return bad("Provider not found", 404);
  const b = await req.json();
  if (!b.modelId) return bad("modelId is required");
  let customBody = null;
  if (b.customBody != null && b.customBody !== "") {
    customBody = typeof b.customBody === "string" ? JSON.parse(b.customBody) : b.customBody;
  }
  return ok(
    createModel({
      providerId: id,
      modelId: b.modelId,
      displayName: b.displayName || b.modelId,
      contextWindow: Number(b.contextWindow) || 128000,
      inputPrice: price(b.inputPrice),
      cacheReadPrice: price(b.cacheReadPrice),
      cacheWritePrice: price(b.cacheWritePrice),
      outputPrice: price(b.outputPrice),
      customBody,
    })
  );
});
