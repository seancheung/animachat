import fs from "node:fs";
import path from "node:path";
import { bad, handler, type IdParams } from "@/lib/api";
import { ASSETS_DIR } from "@/lib/db";
import { getAsset } from "@/lib/store";

export const GET = handler(async (_req: Request, { params }: IdParams) => {
  const { id } = await params;
  if (!/^[a-f0-9]{32}$/.test(id)) return bad("bad asset id", 400);
  const meta = getAsset(id);
  const file = path.join(ASSETS_DIR, id);
  if (!meta || !fs.existsSync(file)) return bad("asset not found", 404);
  const buf = fs.readFileSync(file);
  return new Response(new Uint8Array(buf), {
    headers: {
      "content-type": meta.mime,
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
});
