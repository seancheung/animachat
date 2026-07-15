import fs from "node:fs";
import path from "node:path";
import { bad, handler, type IdParams } from "@/lib/api";
import { ASSETS_DIR } from "@/lib/db";
import { getAsset } from "@/lib/store";

/** Types safe to render inline. The stored MIME is client/manifest-supplied
 *  (bundles are third-party content), and this endpoint is same-origin with the
 *  API — anything that can execute script when navigated to (HTML, SVG, XML)
 *  must download instead of render. */
const RENDERABLE = /^(image\/(?!svg)[\w.+-]+|audio\/[\w.+-]+|video\/[\w.+-]+)$/i;

export const GET = handler(async (_req: Request, { params }: IdParams) => {
  const { id } = await params;
  if (!/^[a-f0-9]{32}$/.test(id)) return bad("bad asset id", 400);
  const meta = getAsset(id);
  const file = path.join(ASSETS_DIR, id);
  if (!meta || !fs.existsSync(file)) return bad("asset not found", 404);
  const buf = fs.readFileSync(file);
  const mime = RENDERABLE.test(meta.mime) ? meta.mime : "application/octet-stream";
  return new Response(new Uint8Array(buf), {
    headers: {
      "content-type": mime,
      "x-content-type-options": "nosniff",
      ...(mime === "application/octet-stream" ? { "content-disposition": "attachment" } : {}),
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
});
