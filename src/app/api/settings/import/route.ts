import { bad, handler, ok } from "@/lib/api";
import { getProvider, putSettings, upsertModel, upsertProvider } from "@/lib/store";
import { DEFAULT_SETTINGS, type Model, type Provider, type Settings } from "@/lib/types";

/**
 * Import a settings-transfer file (see the export route): overwrites global settings,
 * upserts providers & models by id so settings' model references stay valid.
 * Library content and chats are untouched.
 */
export const POST = handler(async (req: Request) => {
  const b = await req.json();
  if (b?.kind !== "animachat-settings") return bad("not an AnimaChat settings export file");
  if (b.version !== 1) return bad(`unsupported settings export version: ${b.version}`);

  const providers = (Array.isArray(b.providers) ? b.providers : []) as Provider[];
  const models = (Array.isArray(b.models) ? b.models : []) as Model[];
  for (const p of providers) {
    if (!p?.id || !p.name || !["anthropic", "openai"].includes(p.type) || !p.baseUrl)
      return bad(`invalid provider entry: ${JSON.stringify(p?.name ?? p)}`);
  }
  for (const m of models) {
    if (!m?.id || !m.providerId || !m.modelId) return bad(`invalid model entry: ${JSON.stringify(m?.modelId ?? m)}`);
  }

  for (const p of providers) {
    upsertProvider({ id: p.id, name: p.name, type: p.type, baseUrl: p.baseUrl, apiKey: p.apiKey ?? "" });
  }
  let skippedModels = 0;
  for (const m of models) {
    // a model is only usable under an existing provider (from this file or already local)
    if (!getProvider(m.providerId)) {
      skippedModels++;
      continue;
    }
    upsertModel({
      id: m.id,
      providerId: m.providerId,
      modelId: m.modelId,
      displayName: m.displayName || m.modelId,
      contextWindow: Number(m.contextWindow) || 128000,
      inputPrice: m.inputPrice ?? null,
      cacheReadPrice: m.cacheReadPrice ?? null,
      cacheWritePrice: m.cacheWritePrice ?? null,
      outputPrice: m.outputPrice ?? null,
      customBody: m.customBody ?? null,
    });
  }

  // only known settings keys travel — a file from a newer version can't plant stray rows
  const patch: Record<string, unknown> = {};
  if (b.settings && typeof b.settings === "object") {
    for (const k of Object.keys(DEFAULT_SETTINGS)) {
      if (k in b.settings) patch[k] = (b.settings as Record<string, unknown>)[k];
    }
  }
  putSettings(patch as Partial<Settings>);

  return ok({ providers: providers.length, models: models.length - skippedModels, skippedModels });
});
