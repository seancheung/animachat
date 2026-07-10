import { bad, handler } from "@/lib/api";
import { exportBundle, type BundleItemType } from "@/lib/bundle";

export const POST = handler(async (req: Request) => {
  const b = await req.json();
  const items = (b.items ?? []) as { type: BundleItemType; id: string }[];
  if (!items.length) return bad("items required");
  const buf = await exportBundle(items);
  return new Response(new Uint8Array(buf), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="animachat-bundle.zip"`,
    },
  });
});
