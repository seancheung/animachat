"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, FileText, Plus, Trash2, Upload } from "lucide-react";
import { EmptyState } from "@/components/app";
import { confirmDialog } from "@/components/confirm";
import Badge from "@/components/ui/badge";
import Button from "@/components/ui/button";
import Input from "@/components/ui/input";
import LoadMoreSentinel from "@/components/ui/load-more";
import Select from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { useDebouncedValue, useInvalidate, usePagedList } from "@/lib/queries";
import { api, downloadBlob } from "@/lib/ui";

/* eslint-disable @typescript-eslint/no-explicit-any */

export default function WritingPage() {
  const router = useRouter();
  const invalidate = useInvalidate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"updated" | "created" | "name">("updated");
  const needle = useDebouncedValue(query.trim());
  const list = usePagedList<any>("/api/writings", { q: needle || undefined, sort });

  const refresh = () => invalidate("/api/writings");

  async function exportWritings(body: { all?: true; ids?: string[] }, name = "animachat-writings.json") {
    const res = await fetch("/api/writings/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(data?.error ?? "Export failed");
    }
    await downloadBlob(res, name);
  }

  async function deleteFiction(item: any) {
    if (!(await confirmDialog({
      title: "Delete fiction",
      message: `Delete “${item.name}”? Its chapters, embedded characters, and writing sessions will be removed.`,
      confirmLabel: "Delete",
      danger: true,
    }))) return;
    await api.del(`/api/writings/${item.id}`);
    await refresh();
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto p-6 space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <Input
            className="flex-1 min-w-60"
            placeholder="Search fiction…"
            value={query}
            onChange={setQuery}
          />
          <div className="w-48">
            <Select
              className="w-full"
              value={sort}
              onChange={setSort}
              options={[
                { value: "updated", label: "Recently updated" },
                { value: "created", label: "Newest first" },
                { value: "name", label: "Name A–Z" },
              ]}
            />
          </div>
          <Button variant="secondary" onClick={() => fileRef.current?.click()}>
            <Upload /> Import
          </Button>
          <Button
            variant="secondary"
            disabled={!list.items.length}
            onClick={async () => {
              try { await exportWritings({ all: true }); }
              catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
            }}
          >
            <Download /> Export all
          </Button>
          <Button onClick={() => router.push("/writing/new")}>
            <Plus /> New fiction
          </Button>
          <input
            ref={fileRef}
            hidden
            type="file"
            accept=".json,application/json"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              try {
                const payload = JSON.parse(await file.text());
                const result = await api.post<{ imported: number }>("/api/writings/import", payload);
                await refresh();
                toast.success(`Imported ${result.imported} fiction project${result.imported === 1 ? "" : "s"}`);
              } catch (err) {
                toast.error(err instanceof Error ? err.message : String(err));
              }
            }}
          />
        </div>

        {!list.isLoading && !list.items.length && (
          <EmptyState>
            {needle
              ? `No fiction matches “${needle}”.`
              : "No fiction yet — start a project, add chapters and characters, then write alongside the AI assistant."}
          </EmptyState>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {list.items.map((item) => (
            <article
              key={item.id}
              className="panel p-4 min-h-48 flex flex-col cursor-pointer hover:border-primary-500 transition-colors"
              onClick={() => router.push(`/writing/${item.id}`)}
            >
              <div className="flex items-start gap-3">
                <div className="size-10 rounded-md bg-primary-500/10 text-primary-500 flex items-center justify-center shrink-0">
                  <FileText size={20} />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="font-medium truncate">{item.name}</h2>
                  <div className="text-xs text-content-400 mt-0.5">
                    {item.chapters?.length ?? 0} chapter{item.chapters?.length === 1 ? "" : "s"} · {item.characters?.length ?? 0} character{item.characters?.length === 1 ? "" : "s"}
                  </div>
                </div>
              </div>
              <p className="text-sm text-content-300 line-clamp-4 mt-3 flex-1">
                {item.synopsis || "No synopsis yet."}
              </p>
              {item.tags?.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {item.tags.slice(0, 4).map((tag: string) => <Badge key={tag} variant="secondary" rounded>{tag}</Badge>)}
                </div>
              )}
              <div className="flex gap-1 mt-3 -ml-1" onClick={(e) => e.stopPropagation()}>
                <Button
                  variant="ghost" size="sm" shape="square" title="Export fiction"
                  onClick={async () => {
                    try { await exportWritings({ ids: [item.id] }, `${item.name}.json`); }
                    catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
                  }}
                ><Download /></Button>
                <Button variant="ghost" size="sm" shape="square" title="Delete fiction" onClick={() => deleteFiction(item)}>
                  <Trash2 />
                </Button>
              </div>
            </article>
          ))}
        </div>
        <LoadMoreSentinel
          hasMore={!!list.hasNextPage}
          isFetching={list.isFetchingNextPage}
          onLoadMore={() => void list.fetchNextPage()}
        />
      </div>
    </div>
  );
}
