import { handler } from "@/lib/api";
import { getSettings, listModels, listProviders } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Settings transfer: global settings + providers & models (including API keys) as one JSON file. */
export const GET = handler(() => {
  const payload = {
    kind: "animachat-settings",
    version: 1,
    settings: getSettings(),
    providers: listProviders(),
    models: listModels(),
  };
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="animachat-settings-${stamp}.json"`,
    },
  });
});
