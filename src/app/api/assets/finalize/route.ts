import { bad, handler, ok } from "@/lib/api";
import {
  ASSET_ID_RE,
  MAX_ASSET_BYTES,
  assetIdOfSha256,
  deleteAssetObjects,
  statAssetObject,
} from "@/lib/assets";
import { registerAsset } from "@/lib/store";

/** Step 2 of a direct-to-bucket upload: the client PUT the bytes; register the
 *  asset row. The object's integrity is already guaranteed (the presigned URL
 *  for key K only accepts bytes hashing to K's checksum) — this step verifies
 *  the object landed and enforces the size cap a presigned PUT can't. */
export const POST = handler(async (req: Request) => {
  const body = await req.json().catch(() => null);
  const hash = String(body?.hash ?? "").toLowerCase();
  const filename = String(body?.filename ?? "file").slice(0, 200);
  const mime = String(body?.mime ?? "") || "application/octet-stream";
  if (!/^[a-f0-9]{64}$/.test(hash)) return bad("hash must be a sha256 hex digest");
  const id = assetIdOfSha256(hash);
  if (!ASSET_ID_RE.test(id)) return bad("bad asset id");

  const stat = await statAssetObject(id);
  if (!stat) return bad("upload not found — PUT the file first", 404);
  if (stat.size > MAX_ASSET_BYTES) {
    await deleteAssetObjects([id]);
    return bad("file too large (max 50MB)", 413);
  }
  await registerAsset(id, filename, mime, stat.size);
  return ok({ id, filename, mime, size: stat.size });
});
