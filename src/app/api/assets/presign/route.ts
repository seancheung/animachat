import { bad, handler, ok } from "@/lib/api";
import { MAX_ASSET_BYTES, assetIdOfSha256, assetObjectExists, presignAssetPut } from "@/lib/assets";
import { getAsset } from "@/lib/store";

/** Step 1 of a direct-to-bucket upload: the client hashed its file (SHA-256)
 *  and asks for a presigned PUT URL. Content addressing is enforced by the
 *  storage layer — the URL is only valid for bytes matching the hash (signed
 *  x-amz-checksum-sha256 header). An already-known asset short-circuits the
 *  upload entirely (`existing`), which is the dedup the content addresses buy. */
export const POST = handler(async (req: Request) => {
  const body = await req.json().catch(() => null);
  const hash = String(body?.hash ?? "").toLowerCase();
  const mime = String(body?.mime ?? "") || "application/octet-stream";
  const size = Number(body?.size ?? 0);
  if (!/^[a-f0-9]{64}$/.test(hash)) return bad("hash must be a sha256 hex digest");
  if (!Number.isFinite(size) || size <= 0) return bad("size is required");
  if (size > MAX_ASSET_BYTES) return bad("file too large (max 50MB)", 413);

  const id = assetIdOfSha256(hash);
  if ((await getAsset(id)) && (await assetObjectExists(id))) return ok({ id, existing: true });

  const { url, headers } = await presignAssetPut(hash, mime);
  return ok({ id, url, headers, existing: false });
});
