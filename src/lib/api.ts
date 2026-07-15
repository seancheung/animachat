import { NextResponse } from "next/server";
import { PageError, clampLimit, type LibrarySort, type PageOpts } from "./store";

/* eslint-disable @typescript-eslint/no-explicit-any */

export function ok(data: any, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/** Wrap a route handler with uniform error handling. */
export function handler<Args extends any[]>(
  fn: (...args: Args) => Promise<Response> | Response
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    try {
      return await fn(...args);
    } catch (e: any) {
      if (e instanceof PageError) return bad(e.message, 400);
      console.error(e);
      return bad(e?.message ?? "Internal error", 500);
    }
  };
}

const SORTS = new Set(["updated", "created", "name"]);

/** Read the standard pagination params off a collection GET. */
export function pageOpts(req: Request): PageOpts {
  const sp = new URL(req.url).searchParams;
  const sort = sp.get("sort") ?? undefined;
  if (sort && !SORTS.has(sort)) throw new PageError("invalid sort");
  return {
    limit: clampLimit(sp.get("limit")),
    cursor: sp.get("cursor"),
    q: sp.get("q") ?? undefined,
    tag: sp.get("tag") ?? undefined,
    sort: sort as LibrarySort | undefined,
  };
}

/** Coerce a request-body price (USD per 1M tokens) — empty/invalid/negative → null (unpriced). */
export function price(v: unknown): number | null {
  const n = Number(v);
  return v == null || v === "" || !Number.isFinite(n) || n < 0 ? null : n;
}

/** Sanitize user text into a download filename (unicode letters/digits, dash-joined). */
export function safeFilename(rawName: string): string {
  return rawName.replace(/[^\p{L}\p{N}-]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "chat";
}

/** Content-Disposition for a download named after user text. Keeps unicode letters/digits;
 *  headers are latin-1 only, so the unicode name rides in RFC 5987 filename* with an
 *  ascii fallback. */
export function attachmentDisposition(rawName: string, ext: string): string {
  const safe = safeFilename(rawName);
  const ascii = safe.replace(/[^\x20-\x7e]+/g, "-").replace(/^-+|-+$/g, "") || "chat";
  return `attachment; filename="${ascii}.${ext}"; filename*=UTF-8''${encodeURIComponent(safe)}.${ext}`;
}

export type IdParams = { params: Promise<{ id: string }> };
