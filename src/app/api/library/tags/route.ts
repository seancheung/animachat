import { bad, handler, ok } from "@/lib/api";
import { LIBRARY_TYPE_KEYS, listDistinctTags, type LibraryType } from "@/lib/store";

/** Distinct tags of one library type, for the tag-filter dropdown. */
export const GET = handler((req: Request) => {
  const type = new URL(req.url).searchParams.get("type");
  if (!type || !LIBRARY_TYPE_KEYS.includes(type as LibraryType)) return bad("invalid type");
  return ok({ tags: listDistinctTags(type as LibraryType) });
});
