import { bad, handler, ok } from "@/lib/api";
import { createProvider, listModels, listProviders } from "@/lib/store";

export const GET = handler(() =>
  ok({ providers: listProviders(), models: listModels() })
);

export const POST = handler(async (req: Request) => {
  const b = await req.json();
  if (!b.name || !b.type) return bad("name and type are required");
  if (!["anthropic", "openai"].includes(b.type)) return bad("type must be anthropic or openai");
  const baseUrl =
    b.baseUrl?.trim() ||
    (b.type === "anthropic" ? "https://api.anthropic.com" : "https://api.openai.com/v1");
  return ok(createProvider({ name: b.name, type: b.type, baseUrl, apiKey: b.apiKey ?? "" }));
});
