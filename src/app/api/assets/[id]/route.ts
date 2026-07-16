import { bad, handler, type IdParams } from "@/lib/api";
import { ASSET_ID_RE, getAssetStream } from "@/lib/assets";
import { getAsset } from "@/lib/store";

/** Types safe to render inline. The stored MIME is client/manifest-supplied
 *  (bundles are third-party content), and this endpoint is same-origin with the
 *  API — anything that can execute script when navigated to (HTML, SVG, XML)
 *  must download instead of render. */
const RENDERABLE = /^(image\/(?!svg)[\w.+-]+|audio\/[\w.+-]+|video\/[\w.+-]+)$/i;

export const GET = handler(async (_req: Request, { params }: IdParams) => {
  const { id } = await params;
  if (!ASSET_ID_RE.test(id)) return bad("bad asset id", 400);
  const meta = await getAsset(id);
  if (!meta) return bad("asset not found", 404);
  const obj = await getAssetStream(id);
  if (!obj) return bad("asset not found", 404);
  const mime = RENDERABLE.test(meta.mime) ? meta.mime : "application/octet-stream";
  return new Response(obj.stream, {
    headers: {
      "content-type": mime,
      ...(obj.size != null ? { "content-length": String(obj.size) } : {}),
      "x-content-type-options": "nosniff",
      ...(mime === "application/octet-stream" ? { "content-disposition": "attachment" } : {}),
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
});
