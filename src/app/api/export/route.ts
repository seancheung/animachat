import { bad, handler } from "@/lib/api";
import { exportBundle, type BundleItemType } from "@/lib/bundle";
import {
  listCharacters,
  listLocations,
  listLorebooks,
  listPersonas,
  listScenes,
  listStories,
} from "@/lib/store";

const LISTS: [BundleItemType, () => { id: string }[]][] = [
  ["character", listCharacters],
  ["persona", listPersonas],
  ["location", listLocations],
  ["scene", listScenes],
  ["story", listStories],
  ["lorebook", listLorebooks],
];

export const POST = handler(async (req: Request) => {
  const b = await req.json();
  // whole-library mode enumerates server-side — the client only sees paginated lists
  const items =
    b.all === true
      ? LISTS.flatMap(([type, list]) => list().map((x) => ({ type, id: x.id })))
      : ((b.items ?? []) as { type: BundleItemType; id: string }[]);
  if (!items.length) return bad(b.all === true ? "The library is empty" : "items required");
  const buf = await exportBundle(items);
  return new Response(new Uint8Array(buf), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="animachat-bundle.zip"`,
    },
  });
});
