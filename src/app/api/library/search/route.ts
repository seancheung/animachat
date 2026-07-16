import { bad, handler, ok } from "@/lib/api";
import { LIBRARY_TYPE_KEYS, clampLimit, searchLibraryNames, type LibraryType } from "@/lib/store";

/** Name search across the whole library (or one `type`, or a comma-separated `types`
 *  subset): `{ items: {type,id,name}[], nextCursor }`. */
export const GET = handler((req: Request) => {
  const sp = new URL(req.url).searchParams;
  const type = sp.get("type") ?? undefined;
  if (type && !LIBRARY_TYPE_KEYS.includes(type as LibraryType)) return bad("invalid type");
  const types = sp.get("types")?.split(",").filter(Boolean);
  if (types && (!types.length || types.some((t) => !LIBRARY_TYPE_KEYS.includes(t as LibraryType))))
    return bad("invalid types");
  return ok(
    searchLibraryNames({
      q: sp.get("q") ?? undefined,
      type: type as LibraryType | undefined,
      types: types as LibraryType[] | undefined,
      limit: clampLimit(sp.get("limit")),
      cursor: sp.get("cursor"),
    })
  );
});
