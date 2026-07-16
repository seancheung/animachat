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

// export-everything scopes: stories have their own section (and Export button), so
// "all" is always all-of-one-side — the library's five types, or every story
const ALL_SCOPES: Record<string, BundleItemType[]> = {
  library: ["character", "persona", "location", "scene", "lorebook"],
  stories: ["story"],
};

export const POST = handler(async (req: Request) => {
  const b = await req.json();
  if (b.all !== undefined && !ALL_SCOPES[b.all]) return bad("unknown export scope");
  // all-mode enumerates server-side — the client only sees paginated lists
  const items = b.all
    ? LISTS.filter(([type]) => ALL_SCOPES[b.all].includes(type)).flatMap(([type, list]) =>
        list().map((x) => ({ type, id: x.id }))
      )
    : ((b.items ?? []) as { type: BundleItemType; id: string }[]);
  if (!items.length)
    return bad(
      b.all === "stories" ? "There are no stories" : b.all ? "The library is empty" : "items required"
    );
  const types = new Set<string>(LISTS.map(([t]) => t));
  const badItem = items.find((it) => !types.has(it?.type) || typeof it?.id !== "string");
  if (badItem) return bad(`unknown item type: ${String(badItem?.type)}`);
  const buf = await exportBundle(items);
  return new Response(new Uint8Array(buf), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="animachat-bundle.zip"`,
    },
  });
});
