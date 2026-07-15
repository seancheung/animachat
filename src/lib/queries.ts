"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { ComboboxOption } from "@/components/ui/combobox";
import { api } from "@/lib/ui";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Server envelope of every paginated collection GET. */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

type Params = Record<string, string | number | undefined>;

function withQuery(path: string, params: Params): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") sp.set(k, String(v));
  const qs = sp.toString();
  return qs ? `${path}?${qs}` : path;
}

/* Query keys are [urlPath, params?]: invalidating the bare path prefix hits every
 * param variant of that list, and never touches "/api/x/<id>" keys (different string). */

/** Plain GET query keyed by its URL. */
export function useGet<T = any>(url: string, opts?: { enabled?: boolean }) {
  return useQuery<T>({
    queryKey: [url],
    queryFn: () => api.get(url),
    enabled: opts?.enabled ?? true,
  });
}

/** Infinite query over a paginated collection; `items` is all loaded pages flattened.
 *  keepPreviousData stops grids flashing empty while a debounced q refetches. */
export function usePagedList<T = any>(path: string, params: Params = {}, opts?: { enabled?: boolean }) {
  const query = useInfiniteQuery({
    queryKey: [path, params],
    queryFn: ({ pageParam }) =>
      api.get(withQuery(path, { ...params, cursor: (pageParam as string | null) ?? undefined })) as Promise<
        Page<T>
      >,
    initialPageParam: null as string | null,
    getNextPageParam: (last: Page<T>) => last.nextCursor,
    placeholderData: keepPreviousData,
    enabled: opts?.enabled ?? true,
  });
  const { data } = query;
  const items = useMemo(() => data?.pages.flatMap((p) => p.items) ?? [], [data]);
  return { ...query, items };
}

/** Prefix invalidation: `invalidate("/api/characters", "/api/library/tags")`. */
export function useInvalidate() {
  const qc = useQueryClient();
  return useCallback(
    async (...prefixes: string[]) => {
      await Promise.all(prefixes.map((p) => qc.invalidateQueries({ queryKey: [p] })));
    },
    [qc]
  );
}

/** Debounce for server-search inputs. The inputs are already IME-composition-aware,
 *  so this debounces committed text only. */
export function useDebouncedValue<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** One-stop wiring for a server-search combobox: owns the (debounced) query text,
 *  pages the endpoint, and maps rows to options. The selected {value,label} is
 *  injected when the current results don't contain it — the combobox displays the
 *  selected label by looking it up in `options`, so it would otherwise show blank. */
export function useComboboxSearch(
  path: string,
  opts?: {
    enabled?: boolean;
    params?: Record<string, string | undefined>;
    selected?: { value: string; label: string } | null;
    toOption?: (item: any) => ComboboxOption<string>;
  }
) {
  const [q, setQ] = useState("");
  const debounced = useDebouncedValue(q.trim());
  const list = usePagedList<any>(
    path,
    { ...opts?.params, q: debounced || undefined },
    { enabled: opts?.enabled }
  );
  const toOption = opts?.toOption;
  const selected = opts?.selected;
  const options = useMemo(() => {
    const map = toOption ?? ((i: any) => ({ value: i.id as string, label: i.name as string }));
    const out = list.items.map(map);
    if (selected && !out.some((o) => o.value === selected.value))
      out.unshift({ value: selected.value, label: selected.label });
    return out;
  }, [list.items, selected, toOption]);
  return {
    options,
    loading: list.isLoading,
    hasMore: !!list.hasNextPage,
    isFetchingMore: list.isFetchingNextPage,
    onLoadMore: () => void list.fetchNextPage(),
    onSearch: setQ,
  };
}

/** Display name of a referenced entity (seeds labels for pre-selected ids). */
export function useEntityName(url: string | null): string | undefined {
  const { data } = useGet<{ name?: string }>(url ?? "", { enabled: !!url });
  return data?.name;
}

/** Resolve a library item id by (type, name) via the search endpoint. LIKE search is
 *  ASCII-case-insensitive only; the exact match over the returned candidates restores
 *  full-Unicode exactness. */
export async function searchIdByName(type: string, name: unknown): Promise<string | undefined> {
  const q = String(name ?? "").trim();
  if (!q) return undefined;
  const page = (await api.get(
    `/api/library/search?type=${type}&q=${encodeURIComponent(q)}&limit=50`
  )) as Page<{ id: string; name: string }>;
  return page.items.find((i) => i.name.trim().toLowerCase() === q.toLowerCase())?.id;
}
