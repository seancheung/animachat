import { handler, ok } from "@/lib/api";
import { getSettings, putSettings } from "@/lib/store";

export const GET = handler(() => ok(getSettings()));

export const PUT = handler(async (req: Request) => {
  putSettings(await req.json());
  return ok(getSettings());
});
