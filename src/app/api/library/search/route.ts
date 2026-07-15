import { bad, handler, ok } from "@/lib/api";
import { LIBRARY_TYPE_KEYS, clampLimit, searchLibraryNames, type LibraryType } from "@/lib/store";

/** Name search across the whole library (or one `type`): `{ items: {type,id,name}[], nextCursor }`. */
export const GET = handler((req: Request) => {
  const sp = new URL(req.url).searchParams;
  const type = sp.get("type") ?? undefined;
  if (type && !LIBRARY_TYPE_KEYS.includes(type as LibraryType)) return bad("invalid type");
  return ok(
    searchLibraryNames({
      q: sp.get("q") ?? undefined,
      type: type as LibraryType | undefined,
      limit: clampLimit(sp.get("limit")),
      cursor: sp.get("cursor"),
    })
  );
});
