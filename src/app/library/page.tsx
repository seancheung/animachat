"use client";

import { useState } from "react";
import { Download, Plus, Sparkles } from "lucide-react";
import { CharacterEditor } from "@/components/editors/CharacterEditor";
import {
  LocationEditor,
  LorebookEditor,
  PersonaEditor,
  SceneEditor,
} from "@/components/editors/SimpleEditors";
import { LIBRARY_CARDS } from "@/components/library/cards";
import { EmptyState, Modal } from "@/components/app";
import { confirmDialog } from "@/components/confirm";
import { AssistantDialog } from "@/components/AssistantDialog";
import { BundleImportButton } from "@/components/ImportDialog";
import { LibraryPicker, type LibraryRef } from "@/components/LibraryPicker";
import Button from "@/components/ui/button";
import Input from "@/components/ui/input";
import LoadMoreSentinel from "@/components/ui/load-more";
import SegmentedControl from "@/components/ui/segmented-control";
import Select from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { useDebouncedValue, useGet, useInvalidate, usePagedList } from "@/lib/queries";
import { api, downloadBlob } from "@/lib/ui";

/* eslint-disable @typescript-eslint/no-explicit-any */

// stories live in their own top-level section (/stories) — a story owns embedded
// copies of its items and is not a library entity
const TYPES = [
  { key: "character", label: "Characters", endpoint: "/api/characters" },
  { key: "persona", label: "Personas", endpoint: "/api/personas" },
  { key: "location", label: "Locations", endpoint: "/api/locations" },
  { key: "scene", label: "Scenes", endpoint: "/api/scenes" },
  { key: "lorebook", label: "Lorebooks", endpoint: "/api/lorebooks" },
] as const;

type TypeKey = (typeof TYPES)[number]["key"];

const EDITORS: Record<TypeKey, any> = {
  character: CharacterEditor,
  persona: PersonaEditor,
  location: LocationEditor,
  scene: SceneEditor,
  lorebook: LorebookEditor,
};

export default function LibraryPage() {
  const [tab, setTab] = useState<TypeKey>("character");
  const [editing, setEditing] = useState<any | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportMode, setExportMode] = useState<"selected" | "all">("selected");
  const [exportSel, setExportSel] = useState<LibraryRef[]>([]);
  const [exporting, setExporting] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);

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
  const Editor = EDITORS[tab];
  const Card = LIBRARY_CARDS[tab];

  async function exportItems(body: { items?: { type: string; id: string }[]; all?: "library" }) {
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
          <BundleImportButton />
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
          <Button variant="secondary" onClick={() => setAssistantOpen(true)}>
            <Sparkles /> Assistant
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
          <div className="w-50">
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
            <div className="w-50">
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

      <AssistantDialog open={assistantOpen} onClose={() => setAssistantOpen(false)} />

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
            ? "Every item in the library — all types — is bundled into a single zip with its assets. Stories are exported from the Stories page."
            : "Check items across any types — everything is bundled into a single zip with its assets. Stories are exported from the Stories page."
        }
        selection={exportSel}
        onChange={setExportSel}
        hidePicker={exportMode === "all"}
        types={TYPES.map((t) => t.key)}
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
                      ? { all: "library" }
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

    </div>
  );
}
