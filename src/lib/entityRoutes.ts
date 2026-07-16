import { bad, handler, ok, pageOpts, type IdParams } from "./api";
import type { Page, PageOpts } from "./store";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Factory for the standard entity CRUD route handlers.
 *  GET is paginated: `?limit=&cursor=&q=&sort=&tag=` → `{ items, nextCursor }`. */
export function collectionRoutes<T>(
  page: (o: PageOpts) => Promise<Page<T>>,
  save: (x: any) => Promise<T>
) {
  return {
    GET: handler(async (req: Request) => ok(await page(pageOpts(req)))),
    POST: handler(async (req: Request) => {
      const body = await req.json();
      delete body.id; // creation never trusts a client id
      return ok(await save(body));
    }),
  };
}

export function itemRoutes<T>(
  get: (id: string) => Promise<T | null>,
  save: (x: any) => Promise<T>,
  del: (id: string) => Promise<void>,
  /** library integrity: names of items still referencing this one — non-empty blocks deletion (409) */
  referencedBy?: (id: string) => Promise<string[]>
) {
  return {
    GET: handler(async (_req: Request, { params }: IdParams) => {
      const item = await get((await params).id);
      return item ? ok(item) : bad("not found", 404);
    }),
    PUT: handler(async (req: Request, { params }: IdParams) => {
      const { id } = await params;
      if (!(await get(id))) return bad("not found", 404);
      const body = await req.json();
      return ok(await save({ ...body, id }));
    }),
    DELETE: handler(async (_req: Request, { params }: IdParams) => {
      const { id } = await params;
      const refs = (await referencedBy?.(id)) ?? [];
      if (refs.length)
        return bad(`Can't delete — used by ${refs.join(", ")}. Remove it there first.`, 409);
      await del(id);
      return ok({ ok: true });
    }),
  };
}
