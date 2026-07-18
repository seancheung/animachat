import { handler } from "@/lib/api";
import { getSettings, listModels, listProviders } from "@/lib/store";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Settings transfer: global settings + providers & models (including API keys) as one JSON file. */
export const GET = handler(async () => {
  const [settings, providers, models] = await Promise.all([
    getSettings(),
    listProviders(),
    listModels(),
  ]);
  // only fields changed from the app defaults travel — the import applies just the keys
  // the file carries, so an untouched knob here doesn't stomp the target instance's own
  // value, and a file from an older app version can't reset settings it never knew about
  const changed: Partial<Settings> = {};
  for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    if (JSON.stringify(settings[k]) !== JSON.stringify(DEFAULT_SETTINGS[k]))
      (changed as Record<string, unknown>)[k] = settings[k];
  }
  const payload = {
    kind: "animachat-settings",
    version: 1,
    settings: changed,
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
