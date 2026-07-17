import { handler, ok } from "@/lib/api";
import { deleteAssetObjects } from "@/lib/assets";
import { collectOrphans } from "@/lib/assetUsage";
import { deleteAssets } from "@/lib/store";

/** Dry run: what a prune would remove. */
export const GET = handler(async () => {
  const { ids, bytes } = await collectOrphans();
  return ok({ count: ids.length, bytes });
});

/** Delete orphaned asset rows and their bucket objects (rows first — a failed
 *  object delete leaves a stray the next prune's bucket branch still sees). */
export const POST = handler(async () => {
  const { ids, bytes } = await collectOrphans();
  await deleteAssets(ids);
  await deleteAssetObjects(ids);
  return ok({ removed: ids.length, bytes });
});
