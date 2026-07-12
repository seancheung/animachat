import { NextResponse } from "next/server";

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
      console.error(e);
      return bad(e?.message ?? "Internal error", 500);
    }
  };
}

/** Coerce a request-body price (USD per 1M tokens) — empty/invalid/negative → null (unpriced). */
export function price(v: unknown): number | null {
  const n = Number(v);
  return v == null || v === "" || !Number.isFinite(n) || n < 0 ? null : n;
}

export type IdParams = { params: Promise<{ id: string }> };
