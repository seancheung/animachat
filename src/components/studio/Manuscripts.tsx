"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, Download, FileText, Trash2, Upload } from "lucide-react";
import { EmptyState } from "@/components/app";
import { confirmDialog } from "@/components/confirm";
import { LibraryPicker, type LibraryRef } from "@/components/LibraryPicker";
import Badge from "@/components/ui/badge";
import Button from "@/components/ui/button";
import Input from "@/components/ui/input";
import LoadMoreSentinel from "@/components/ui/load-more";
import SegmentedControl from "@/components/ui/segmented-control";
import Select from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { useDebouncedValue, useInvalidate, usePagedList } from "@/lib/queries";
import { api, downloadBlob } from "@/lib/ui";

/* eslint-disable @typescript-eslint/no-explicit-any */

export function Manuscripts() {
  const router = useRouter();
  const invalidate = useInvalidate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"updated" | "created" | "name">("updated");
  const [adaptingId, setAdaptingId] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportMode, setExportMode] = useState<"selected" | "all">("selected");
  const [exportSelection, setExportSelection] = useState<LibraryRef[]>([]);
  const [exporting, setExporting] = useState(false);
  const needle = useDebouncedValue(query.trim());
  const list = usePagedList<any>("/api/manuscripts", { q: needle || undefined, sort });

  const refresh = () => invalidate("/api/manuscripts");

  async function exportManuscripts(body: { all?: true; ids?: string[] }, name = "animachat-manuscripts.json") {
    const res = await fetch("/api/manuscripts/export", {
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

  async function deleteManuscript(item: any) {
    if (!(await confirmDialog({
      title: "Delete manuscript",
      message: `Delete “${item.name}”? Its chapters, embedded characters, and assistant sessions will be removed.`,
      confirmLabel: "Delete",
      danger: true,
    }))) return;
    await api.del(`/api/manuscripts/${item.id}`);
    await refresh();
  }

  async function adaptToStory(item: any) {
    if (!(await confirmDialog({
      title: "Create interactive adaptation?",
      message: "This creates an independent interactive-story scaffold with the manuscript's synopsis, embedded characters, and one scene per chapter. Manuscript prose stays in the original and is not copied into playthrough prompts.",
      confirmLabel: "Create story",
    }))) return;
    setAdaptingId(item.id);
    try {
      const result = await api.post<{ id: string }>("/api/studio/adapt", { sourceType: "manuscript", id: item.id });
      toast.success("Interactive adaptation created");
      router.push(`/stories/${result.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setAdaptingId(null);
    }
  }

  return (
    <>
      <div className="space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <Input
            className="flex-1 min-w-60"
            placeholder="Search manuscripts…"
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
          <Button className="ml-2" variant="secondary" onClick={() => fileRef.current?.click()}>
            <Upload /> Import
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setExportSelection([]);
              setExportMode("selected");
              setExportOpen(true);
            }}
          >
            <Download /> Export
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
                const result = await api.post<{ imported: number }>("/api/manuscripts/import", payload);
                await refresh();
                toast.success(`Imported ${result.imported} manuscript${result.imported === 1 ? "" : "s"}`);
              } catch (err) {
                toast.error(err instanceof Error ? err.message : String(err));
              }
            }}
          />
        </div>

        {!list.isLoading && !list.items.length && (
          <EmptyState>
            {needle
              ? `No manuscripts match “${needle}”.`
              : "No manuscripts yet — start a project, add chapters and characters, then write alongside the AI assistant."}
          </EmptyState>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {list.items.map((item) => (
            <article
              key={item.id}
              className="panel p-4 min-h-48 flex flex-col cursor-pointer hover:border-primary-500 transition-colors"
              onClick={() => router.push(`/manuscripts/${item.id}`)}
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
                  variant="ghost" size="sm" shape="square" title="Create interactive adaptation"
                  disabled={adaptingId === item.id}
                  onClick={() => void adaptToStory(item)}
                ><ArrowRightLeft /></Button>
                <Button
                  variant="ghost" size="sm" shape="square" title="Export manuscript"
                  onClick={async () => {
                    try { await exportManuscripts({ ids: [item.id] }, `${item.name}.json`); }
                    catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
                  }}
                ><Download /></Button>
                <Button variant="ghost" size="sm" shape="square" title="Delete manuscript" onClick={() => deleteManuscript(item)}>
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

      <LibraryPicker
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        title="Export manuscripts"
        header={
          <SegmentedControl
            variant="secondary"
            className="w-full"
            items={[
              { value: "selected", label: "Selected manuscripts" },
              { value: "all", label: "All manuscripts" },
            ]}
            value={exportMode}
            onChange={setExportMode}
          />
        }
        hint={
          exportMode === "all"
            ? "Export every manuscript, including its chapters, embedded characters, and assistant sessions."
            : "Choose the manuscripts to include in the export."
        }
        selection={exportSelection}
        onChange={setExportSelection}
        hidePicker={exportMode === "all"}
        searchPath="/api/manuscripts"
        itemType="manuscript"
        placeholder="Search manuscripts…"
        footer={
          <>
            <Button variant="secondary" onClick={() => setExportOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={exporting || (exportMode === "selected" && !exportSelection.length)}
              onClick={async () => {
                setExporting(true);
                try {
                  await exportManuscripts(
                    exportMode === "all"
                      ? { all: true }
                      : { ids: exportSelection.map(({ id }) => id) }
                  );
                  setExportOpen(false);
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : String(error));
                } finally {
                  setExporting(false);
                }
              }}
            >
              <Download />{" "}
              {exporting
                ? "Exporting…"
                : exportMode === "all"
                  ? "Export all manuscripts"
                  : exportSelection.length
                    ? `Export ${exportSelection.length} manuscript${exportSelection.length === 1 ? "" : "s"}`
                    : "Export manuscripts"}
            </Button>
          </>
        }
      />
    </>
  );
}
