"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Download, MoreHorizontal, Plus, Sparkles, Upload } from "lucide-react";
import { AssistantDialog } from "@/components/AssistantDialog";
import { BundleImportButton } from "@/components/ImportDialog";
import { LibraryPicker, type LibraryRef } from "@/components/LibraryPicker";
import { EmptyState, Modal } from "@/components/app";
import { confirmDialog } from "@/components/confirm";
import { CharacterEditor } from "@/components/editors/CharacterEditor";
import {
  LocationEditor,
  LorebookEditor,
  PersonaEditor,
  SceneEditor,
} from "@/components/editors/SimpleEditors";
import { LIBRARY_CARDS } from "@/components/library/cards";
import { InteractiveStories } from "@/components/studio/InteractiveStories";
import { Manuscripts } from "@/components/studio/Manuscripts";
import Button from "@/components/ui/button";
import Input from "@/components/ui/input";
import LoadMoreSentinel from "@/components/ui/load-more";
import Popover from "@/components/ui/popover";
import SegmentedControl from "@/components/ui/segmented-control";
import Select from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { useDebouncedValue, useGet, useInvalidate, usePagedList } from "@/lib/queries";
import { api, downloadBlob } from "@/lib/ui";

/* eslint-disable @typescript-eslint/no-explicit-any */

const TYPES = [
  { key: "character", label: "Characters", endpoint: "/api/characters" },
  { key: "persona", label: "Personas", endpoint: "/api/personas" },
  { key: "location", label: "Locations", endpoint: "/api/locations" },
  { key: "scene", label: "Scenes", endpoint: "/api/scenes" },
  { key: "lorebook", label: "Lorebooks", endpoint: "/api/lorebooks" },
  { key: "story", label: "Stories", endpoint: "/api/stories" },
  { key: "manuscript", label: "Manuscripts", endpoint: "/api/manuscripts" },
] as const;

type TypeKey = (typeof TYPES)[number]["key"];
type EntityTypeKey = Exclude<TypeKey, "story" | "manuscript">;

const EDITORS: Record<EntityTypeKey, any> = {
  character: CharacterEditor,
  persona: PersonaEditor,
  location: LocationEditor,
  scene: SceneEditor,
  lorebook: LorebookEditor,
};

function LibraryContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get("type");
  const tab: TypeKey = TYPES.some(({ key }) => key === requestedTab)
    ? requestedTab as TypeKey
    : "character";
  const entityTab = tab !== "story" && tab !== "manuscript";
  const type = TYPES.find((item) => item.key === tab)!;

  const [editing, setEditing] = useState<any | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportMode, setExportMode] = useState<"selected" | "all">("selected");
  const [exportSel, setExportSel] = useState<LibraryRef[]>([]);
  const [exporting, setExporting] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"updated" | "created" | "name">("updated");
  const [tagFilter, setTagFilter] = useState("");

  const debouncedQuery = useDebouncedValue(query.trim());
  const filtered = !!(debouncedQuery || tagFilter);
  const list = usePagedList<any>(
    type.endpoint,
    {
      q: debouncedQuery || undefined,
      tag: tagFilter || undefined,
      sort,
    },
    { enabled: entityTab }
  );
  const items = list.items;
  const { data: tagsData } = useGet<{ tags: string[] }>(`/api/library/tags?type=${tab}`, {
    enabled: true,
  });
  const allTags = tagsData?.tags ?? [];
  const invalidate = useInvalidate();
  const refresh = () => invalidate(type.endpoint, "/api/library/tags", "/api/library/search");
  // Special tabs render their own page components below; these fallbacks keep the
  // modal/grid component types concrete without weakening the tab union.
  const Editor = EDITORS[tab as EntityTypeKey] ?? CharacterEditor;
  const Card = LIBRARY_CARDS[tab as EntityTypeKey] ?? LIBRARY_CARDS.character;

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
    if (!(await confirmDialog({
      title: `Delete ${tab}`,
      message: `Delete "${item.name}"?`,
      confirmLabel: "Delete",
      danger: true,
    }))) return;
    try {
      await api.del(`${type.endpoint}/${item.id}`);
      refresh();
    } catch (error) {
      // referenced items are protected server-side (409 names what still uses them)
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto p-6 space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <Input
            className="w-44 min-w-0 shrink-0"
            placeholder={`Search ${type.label.toLowerCase()}…`}
            value={query}
            onChange={setQuery}
          />
          <div className="w-36 shrink-0">
            <Select
              className="w-full min-w-0"
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
            <div className="w-36 shrink-0">
              <Select
                className="w-full min-w-0"
                value={tagFilter}
                onChange={setTagFilter}
                options={[
                  { value: "", label: "All tags" },
                  ...allTags.map((tag) => ({ value: tag, label: tag })),
                ]}
              />
            </div>
          )}
          <span className="min-w-2 flex-1" />
          <BundleImportButton
            renderTrigger={(openImport) => (
              <Popover
                side="bottom"
                align="end"
                className="w-44 p-1.5"
                content={({ close }) => (
                  <div className="space-y-1">
                    <button
                      type="button"
                      className="flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-left hover:bg-base-300/60"
                      onClick={() => {
                        close();
                        openImport();
                      }}
                    >
                      <Upload size={15} /> Import
                    </button>
                    <button
                      type="button"
                      className="flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-left hover:bg-base-300/60"
                      onClick={() => {
                        close();
                        setExportSel([]);
                        setExportMode("selected");
                        setExportOpen(true);
                      }}
                    >
                      <Download size={15} /> Export
                    </button>
                  </div>
                )}
              >
                <Button variant="secondary" shape="square" title="Import or export">
                  <MoreHorizontal />
                </Button>
              </Popover>
            )}
          />
          <Button
            variant="secondary"
            disabled={!entityTab}
            title={entityTab ? "Open the library assistant" : "Use the assistant inside the editor"}
            onClick={() => setAssistantOpen(true)}
          >
            <Sparkles /> Assistant
          </Button>
          <Button
            onClick={() => {
              if (tab === "story") router.push("/stories/new");
              else if (tab === "manuscript") router.push("/manuscripts/new");
              else setEditing({});
            }}
          >
            <Plus /> New
          </Button>
        </div>

        <SegmentedControl<TypeKey>
          variant="secondary"
          className="w-full"
          items={TYPES.map((item) => ({ value: item.key, label: item.label }))}
          value={tab}
          onChange={(next) => {
            setTagFilter("");
            setEditing(null);
            router.replace(`/library?type=${next}`, { scroll: false });
          }}
        />

        {tab === "story" ? (
          <InteractiveStories
            query={debouncedQuery}
            sort={sort}
            tag={tagFilter}
            onExport={(id) => void exportItems({ items: [{ type: "story", id }] })}
          />
        ) : tab === "manuscript" ? (
          <Manuscripts
            query={debouncedQuery}
            sort={sort}
            tag={tagFilter}
            onExport={(id) => void exportItems({ items: [{ type: "manuscript", id }] })}
          />
        ) : (
          <>
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
          </>
        )}
      </div>

      <AssistantDialog open={assistantOpen} onClose={() => setAssistantOpen(false)} />

      <LibraryPicker
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        title="Export library"
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
            ? "Every item across all Library tabs is bundled into one zip with its referenced assets."
            : "Choose any combination of library items, stories, and manuscripts for one bundle."
        }
        selection={exportSel}
        onChange={setExportSel}
        hidePicker={exportMode === "all"}
        types={TYPES.map((item) => item.key)}
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
                  await exportItems(
                    exportMode === "all"
                      ? { all: "library" }
                      : { items: exportSel.map(({ type: itemType, id }) => ({ type: itemType, id })) }
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

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? `Edit ${editing.name}` : `New ${tab}`}
        wide
        dismissable={false}
      >
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

export default function LibraryPage() {
  return (
    <Suspense fallback={<div className="p-6 text-content-400">Loading Library…</div>}>
      <LibraryContent />
    </Suspense>
  );
}
