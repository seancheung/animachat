import crypto from "node:crypto";
import { Readable } from "node:stream";
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/* Uploaded assets live in an S3 bucket (MinIO). Keys are the content-addressed
 * asset ids: the first 32 hex chars of the file's SHA-256. Metadata (filename,
 * mime, size) stays in the assets table — the bucket stores bytes only. */

const ENDPOINT = process.env.S3_ENDPOINT ?? "http://localhost:9000";
/** The browser-reachable endpoint presigned URLs are signed against — inside
 *  docker the internal one (http://minio:9000) is dead on arrival for a browser. */
const PUBLIC_ENDPOINT = process.env.S3_PUBLIC_ENDPOINT ?? ENDPOINT;
export const BUCKET = process.env.S3_BUCKET ?? "animachat";
const REGION = process.env.S3_REGION ?? "us-east-1";
const CREDENTIALS = {
  accessKeyId: process.env.S3_ACCESS_KEY ?? "animachat",
  secretAccessKey: process.env.S3_SECRET_KEY ?? "animachat",
};

export const MAX_ASSET_BYTES = 50 * 1024 * 1024;
export const ASSET_ID_RE = /^[a-f0-9]{32}$/;
const SHA256_HEX_RE = /^[a-f0-9]{64}$/;

declare global {
  // eslint-disable-next-line no-var
  var __animachatS3: S3Client | undefined;
  // eslint-disable-next-line no-var
  var __animachatS3Public: S3Client | undefined;
}

function s3(): S3Client {
  if (!globalThis.__animachatS3)
    globalThis.__animachatS3 = new S3Client({
      endpoint: ENDPOINT,
      region: REGION,
      credentials: CREDENTIALS,
      forcePathStyle: true, // MinIO serves buckets by path, not subdomain
    });
  return globalThis.__animachatS3;
}

/** Signs presigned URLs only — the signature covers the host, so this client is
 *  configured with the endpoint the BROWSER will hit. */
function s3Public(): S3Client {
  if (!globalThis.__animachatS3Public)
    globalThis.__animachatS3Public = new S3Client({
      endpoint: PUBLIC_ENDPOINT,
      region: REGION,
      credentials: CREDENTIALS,
      forcePathStyle: true,
    });
  return globalThis.__animachatS3Public;
}

const notFound = (e: unknown) =>
  (e as { name?: string })?.name === "NoSuchKey" || (e as { name?: string })?.name === "NotFound";

export function assetIdOfSha256(hexDigest: string): string {
  return hexDigest.slice(0, 32);
}

export function sha256Hex(data: Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

export async function putAssetObject(id: string, data: Buffer, mime?: string): Promise<void> {
  await s3().send(
    new PutObjectCommand({ Bucket: BUCKET, Key: id, Body: data, ContentType: mime })
  );
}

export async function getAssetBuffer(id: string): Promise<Buffer | null> {
  try {
    const res = await s3().send(new GetObjectCommand({ Bucket: BUCKET, Key: id }));
    return Buffer.from(await res.Body!.transformToByteArray());
  } catch (e) {
    if (notFound(e)) return null;
    throw e;
  }
}

/** Stream + size for the serve route — the body never buffers in the app. */
export async function getAssetStream(
  id: string
): Promise<{ stream: ReadableStream; size: number | undefined } | null> {
  try {
    const res = await s3().send(new GetObjectCommand({ Bucket: BUCKET, Key: id }));
    return {
      stream: Readable.toWeb(res.Body as Readable) as ReadableStream,
      size: res.ContentLength,
    };
  } catch (e) {
    if (notFound(e)) return null;
    throw e;
  }
}

export async function statAssetObject(id: string): Promise<{ size: number } | null> {
  try {
    const res = await s3().send(new HeadObjectCommand({ Bucket: BUCKET, Key: id }));
    return { size: res.ContentLength ?? 0 };
  } catch (e) {
    if (notFound(e)) return null;
    throw e;
  }
}

export async function assetObjectExists(id: string): Promise<boolean> {
  return (await statAssetObject(id)) !== null;
}

export async function deleteAssetObjects(ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i += 1000) {
    await s3().send(
      new DeleteObjectsCommand({
        Bucket: BUCKET,
        Delete: { Objects: ids.slice(i, i + 1000).map((id) => ({ Key: id })), Quiet: true },
      })
    );
  }
}

/** Every asset-shaped object in the bucket (id-keyed; anything else is ignored). */
export async function listAssetObjects(): Promise<{ id: string; size: number; lastModified: number }[]> {
  const out: { id: string; size: number; lastModified: number }[] = [];
  let token: string | undefined;
  do {
    const res = await s3().send(
      new ListObjectsV2Command({ Bucket: BUCKET, ContinuationToken: token })
    );
    for (const o of res.Contents ?? []) {
      if (!o.Key || !ASSET_ID_RE.test(o.Key)) continue;
      out.push({ id: o.Key, size: o.Size ?? 0, lastModified: o.LastModified?.getTime() ?? 0 });
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return out;
}

/** Presign a direct-to-bucket PUT for a client that hashed its file. The full
 *  SHA-256 rides as a signed x-amz-checksum-sha256 header, so MinIO itself
 *  rejects bytes that don't match the claimed hash — content addressing holds
 *  without the app ever seeing the payload. */
export async function presignAssetPut(
  sha256hex: string,
  mime: string
): Promise<{ id: string; url: string; headers: Record<string, string> }> {
  if (!SHA256_HEX_RE.test(sha256hex)) throw new Error("bad sha256");
  const id = assetIdOfSha256(sha256hex);
  const checksumB64 = Buffer.from(sha256hex, "hex").toString("base64");
  const cmd = new PutObjectCommand({
    Bucket: BUCKET,
    Key: id,
    ContentType: mime,
    ChecksumSHA256: checksumB64,
  });
  const url = await getSignedUrl(s3Public(), cmd, {
    expiresIn: 600,
    // keep the checksum a required HEADER (not a hoisted query param) so the
    // storage layer receives and enforces it
    unhoistableHeaders: new Set(["x-amz-checksum-sha256", "x-amz-sdk-checksum-algorithm"]),
  });
  return {
    id,
    url,
    headers: {
      "content-type": mime,
      "x-amz-checksum-sha256": checksumB64,
      "x-amz-sdk-checksum-algorithm": "SHA256",
    },
  };
}

/** Write an imported asset only if its bytes hash to its claimed id (ids are
 *  content addresses, so an existing object is by definition identical and is
 *  never overwritten — a manifest can't replace another asset's bytes).
 *  False = the bytes don't match the id; the asset is skipped. */
export async function writeVerifiedAsset(id: string, data: Buffer, mime?: string): Promise<boolean> {
  if (await assetObjectExists(id)) return true;
  if (assetIdOfSha256(sha256Hex(data)) !== id) return false;
  await putAssetObject(id, data, mime);
  return true;
}
