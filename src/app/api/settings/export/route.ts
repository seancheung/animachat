import { handler } from "@/lib/api";
import { getSettings, listModels, listProviders } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Settings transfer: global settings + providers & models (including API keys) as one JSON file. */
export const GET = handler(async () => {
  const [settings, providers, models] = await Promise.all([
    getSettings(),
    listProviders(),
    listModels(),
  ]);
  const payload = {
    kind: "animachat-settings",
    version: 1,
    settings,
    providers,
    models,
  };
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="animachat-settings-${stamp}.json"`,
    },
  });
});
