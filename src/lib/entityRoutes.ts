import { bad, handler, ok, type IdParams } from "./api";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Factory for the standard entity CRUD route handlers. */
export function collectionRoutes<T>(list: () => T[], save: (x: any) => T) {
  return {
    GET: handler(() => ok(list())),
    POST: handler(async (req: Request) => {
      const body = await req.json();
      delete body.id; // creation never trusts a client id
      return ok(save(body));
    }),
  };
}

export function itemRoutes<T>(
  get: (id: string) => T | null,
  save: (x: any) => T,
  del: (id: string) => void,
  /** library integrity: names of items still referencing this one — non-empty blocks deletion (409) */
  referencedBy?: (id: string) => string[]
) {
  return {
    GET: handler(async (_req: Request, { params }: IdParams) => {
      const item = get((await params).id);
      return item ? ok(item) : bad("not found", 404);
    }),
    PUT: handler(async (req: Request, { params }: IdParams) => {
      const { id } = await params;
      if (!get(id)) return bad("not found", 404);
      const body = await req.json();
      return ok(save({ ...body, id }));
    }),
    DELETE: handler(async (_req: Request, { params }: IdParams) => {
      const { id } = await params;
      const refs = referencedBy?.(id) ?? [];
      if (refs.length)
        return bad(`Can't delete — used by ${refs.join(", ")}. Remove it there first.`, 409);
      del(id);
      return ok({ ok: true });
    }),
  };
}
