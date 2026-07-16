import { handler, ok } from "@/lib/api";
import { listAssetObjects } from "@/lib/assets";

/** Bucket stats: uploaded-asset count and total bytes (settings storage panel). */
export const GET = handler(async () => {
  let count = 0;
  let bytes = 0;
  for (const o of await listAssetObjects()) {
    count++;
    bytes += o.size;
  }
  return ok({ count, bytes });
});
