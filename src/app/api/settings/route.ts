import { handler, ok } from "@/lib/api";
import { getSettings, putSettings } from "@/lib/store";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/types";

export const GET = handler(() => ok(getSettings()));

export const PUT = handler(async (req: Request) => {
  const b = await req.json();
  // only known keys land in the settings table — a stray/typo'd key would
  // otherwise persist forever and ride into every getSettings() spread
  const patch: Partial<Settings> = {};
  for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    if (k in b) patch[k] = b[k];
  }
  putSettings(patch);
  return ok(getSettings());
});
