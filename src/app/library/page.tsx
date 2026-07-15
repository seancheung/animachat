"use client";

import { useRef, useState } from "react";
import { Download, Plus, Sparkles, Upload } from "lucide-react";
import { CharacterEditor } from "@/components/editors/CharacterEditor";
import {
  LocationEditor,
  LorebookEditor,
  PersonaEditor,
  SceneEditor,
  StoryEditor,
} from "@/components/editors/SimpleEditors";
import { LIBRARY_CARDS } from "@/components/library/cards";
import { EmptyState, Modal } from "@/components/app";
import { confirmDialog } from "@/components/confirm";
import { GuideDialog } from "@/components/GuideDialog";
import { ImportDialog } from "@/components/ImportDialog";
import { LibraryPicker, type LibraryRef } from "@/components/LibraryPicker";
import Button from "@/components/ui/button";
import Input from "@/components/ui/input";
import LoadMoreSentinel from "@/components/ui/load-more";
import SegmentedControl from "@/components/ui/segmented-control";
import Select from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { useDebouncedValue, useGet, useInvalidate, usePagedList } from "@/lib/queries";
import { api, downloadBlob } from "@/lib/ui";
import type { BundlePreviewItem } from "@/lib/bundle";

/* eslint-disable @typescript-eslint/no-explicit-any */

const TYPES = [
  { key: "character", label: "Characters", endpoint: "/api/characters" },
  { key: "persona", label: "Personas", endpoint: "/api/personas" },
  { key: "location", label: "Locations", endpoint: "/api/locations" },
  { key: "scene", label: "Scenes", endpoint: "/api/scenes" },
  { key: "story", label: "Stories", endpoint: "/api/stories" },
  { key: "lorebook", label: "Lorebooks", endpoint: "/api/lorebooks" },
] as const;

type TypeKey = (typeof TYPES)[number]["key"];

const EDITORS: Record<TypeKey, any> = {
  character: CharacterEditor,
  persona: PersonaEditor,
  location: LocationEditor,
  scene: SceneEditor,
  story: StoryEditor,
  lorebook: LorebookEditor,
};

export default function LibraryPage() {
  const [tab, setTab] = useState<TypeKey>("character");
  const [editing, setEditing] = useState<any | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportMode, setExportMode] = useState<"selected" | "all">("selected");
  const [exportSel, setExportSel] = useState<LibraryRef[]>([]);
  const [exporting, setExporting] = useState(false);
  const [importPreview, setImportPreview] = useState<{ file: File; items: BundlePreviewItem[] } | null>(null);
  const [importing, setImporting] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"updated" | "created" | "name">("updated");
  const [tagFilter, setTagFilter] = useState("");

  const type = TYPES.find((t) => t.key === tab)!;
  const debouncedQuery = useDebouncedValue(query.trim());
  const filtered = !!(debouncedQuery || tagFilter);
  const list = usePagedList<any>(type.endpoint, {
    q: debouncedQuery || undefined,
    tag: tagFilter || undefined,
    sort,
  });
  const items = list.items;
  const { data: tagsData } = useGet<{ tags: string[] }>(`/api/library/tags?type=${tab}`);
  const allTags = tagsData?.tags ?? [];
  const invalidate = useInvalidate();
  const refresh = () => invalidate(type.endpoint, "/api/library/tags", "/api/library/search");
  const refreshAll = () =>
    invalidate(...TYPES.map((t) => t.endpoint), "/api/library/tags", "/api/library/search");
  const Editor = EDITORS[tab];
  const Card = LIBRARY_CARDS[tab];

  async function exportItems(body: { items?: { type: string; id: string }[]; all?: true }) {
    const res = await fetch("/api/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      return toast.error(data?.error ?? "Export failed");
    }
    await downloadBlob(res, "animachat-bundle.zip");
  }

  async function deleteItem(item: any) {
    if (!(await confirmDialog({ title: `Delete ${tab}`, message: `Delete "${item.name}"?`, confirmLabel: "Delete", danger: true }))) return;
    try {
      await api.del(`${type.endpoint}/${item.id}`);
      refresh();
    } catch (e) {
      // referenced items are protected server-side (409 names what still uses them)
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto p-6 space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <SegmentedControl
            variant="secondary"
            className="flex-1 mr-8"
            items={TYPES.map((t) => ({ value: t.key, label: t.label }))}
            value={tab}
            onChange={(v) => {
              setTab(v);
              setTagFilter(""); // tags are per-type — a filter can't carry across tabs
            }}
          />
          <Button variant="secondary" onClick={() => importRef.current?.click()}>
            <Upload /> Import
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setExportSel([]);
              setExportMode("selected");
              setExportOpen(true);
            }}
          >
            <Download /> Export
          </Button>
          <Button variant="secondary" onClick={() => setGuideOpen(true)}>
            <Sparkles /> Guide
          </Button>
          <Button onClick={() => setEditing({})}>
            <Plus /> New
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <div className="w-64">
            <Input
              className="w-full"
              placeholder={`Search ${type.label.toLowerCase()}…`}
              value={query}
              onChange={setQuery}
            />
          </div>
          <div className="w-44">
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
          {allTags.length > 0 && (
            <div className="w-44">
              <Select
                className="w-full"
                value={tagFilter}
                onChange={setTagFilter}
                options={[
                  { value: "", label: "All tags" },
                  ...allTags.map((t) => ({ value: t, label: t })),
                ]}
              />
            </div>
          )}
        </div>

        {!list.isLoading && items.length === 0 && !filtered && (
          <EmptyState>
            No {type.label.toLowerCase()} yet — create one, or import a bundle. The AI co-writer in
            the editor can help you flesh it out.
          </EmptyState>
        )}
        {!list.isLoading && items.length === 0 && filtered && (
          <EmptyState>
            Nothing matches {debouncedQuery ? `“${debouncedQuery}”` : `the tag “${tagFilter}”`}.
          </EmptyState>
        )}

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {items.map((item) => (
            <Card
              key={item.id}
              item={item}
              onOpen={() => setEditing(item)}
              onExport={() => exportItems({ items: [{ type: tab, id: item.id }] })}
              onDelete={() => deleteItem(item)}
            />
          ))}
        </div>
        <LoadMoreSentinel
          hasMore={!!list.hasNextPage}
          isFetching={list.isFetchingNextPage}
          onLoadMore={() => void list.fetchNextPage()}
        />
      </div>

      <GuideDialog open={guideOpen} onClose={() => setGuideOpen(false)} />

      <LibraryPicker
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        title="Export library items"
        header={
          <SegmentedControl
            variant="secondary"
            className="w-full"
            items={[
              { value: "selected", label: "Selected items" },
              { value: "all", label: "Whole library" },
            ]}
            value={exportMode}
            onChange={setExportMode}
          />
        }
        hint={
          exportMode === "all"
            ? "Every item in the library — all types — is bundled into a single zip with its assets."
            : "Check items across any types — everything is bundled into a single zip with its assets."
        }
        selection={exportSel}
        onChange={setExportSel}
        hidePicker={exportMode === "all"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setExportOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={exporting || (exportMode === "selected" && !exportSel.length)}
              onClick={async () => {
                setExporting(true);
                try {
                  // whole-library mode enumerates server-side — the client only sees pages
                  await exportItems(
                    exportMode === "all"
                      ? { all: true }
                      : { items: exportSel.map(({ type, id }) => ({ type, id })) }
                  );
                  setExportOpen(false);
                } finally {
                  setExporting(false);
                }
              }}
            >
              <Download />{" "}
              {exporting
                ? "Exporting…"
                : exportMode === "all"
                  ? "Export whole library"
                  : `Export ${exportSel.length || ""} item${exportSel.length === 1 ? "" : "s"}`}
            </Button>
          </>
        }
      />

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? `Edit ${editing.name}` : `New ${tab}`} wide dismissable={false}>
        {editing && (
          <Editor
            initial={editing}
            onSaved={() => {
              setEditing(null);
              refresh();
            }}
          />
        )}
      </Modal>

      <ImportDialog
        open={!!importPreview}
        items={importPreview?.items ?? []}
        importing={importing}
        onClose={() => setImportPreview(null)}
        onConfirm={async (selected) => {
          if (!importPreview) return;
          setImporting(true);
          try {
            const fd = new FormData();
            fd.append("file", importPreview.file);
            fd.append("selected", JSON.stringify(selected));
            const res = await fetch("/api/import", { method: "POST", body: fd });
            const data = await res.json();
            if (!res.ok) return toast.error(data?.error ?? "Import failed");
            toast.success(
              "Imported: " +
                (Object.entries(data.imported ?? {})
                  .map(([k, v]) => `${v} ${k}(s)`)
                  .join(", ") || "nothing")
            );
            setImportPreview(null);
            refreshAll(); // a bundle can create items of every type
          } finally {
            setImporting(false);
          }
        }}
      />

      <input
        ref={importRef}
        type="file"
        hidden
        accept=".zip"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          // list the bundle first — the dialog picks what to import
          const fd = new FormData();
          fd.append("file", f);
          fd.append("preview", "1");
          const res = await fetch("/api/import", { method: "POST", body: fd });
          const data = await res.json();
          if (!res.ok) return toast.error(data?.error ?? "Import failed");
          setImportPreview({ file: f, items: data.items ?? [] });
        }}
      />
    </div>
  );
}
