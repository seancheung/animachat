"use client";

import { useMemo, useRef, useState } from "react";
import useSWR from "swr";
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
import { LibraryPicker, type LibraryRef } from "@/components/LibraryPicker";
import Button from "@/components/ui/button";
import Input from "@/components/ui/input";
import SegmentedControl from "@/components/ui/segmented-control";
import Select from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { api, downloadBlob } from "@/lib/ui";

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
  const [exportSel, setExportSel] = useState<LibraryRef[]>([]);
  const [exporting, setExporting] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"updated" | "created" | "name">("updated");

  const type = TYPES.find((t) => t.key === tab)!;
  const { data: items, mutate } = useSWR<any[]>(type.endpoint, api.get);
  const Editor = EDITORS[tab];
  const Card = LIBRARY_CARDS[tab];

  const shown = useMemo(() => {
    let list = items ?? [];
    const q = query.trim().toLowerCase();
    if (q)
      list = list.filter((i) =>
        [i.name, i.description, i.setup].some(
          (t) => typeof t === "string" && t.toLowerCase().includes(q)
        )
      );
    const by: Record<typeof sort, (a: any, b: any) => number> = {
      name: (a, b) => String(a.name).localeCompare(String(b.name)),
      created: (a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0),
      updated: (a, b) =>
        (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0),
    };
    return [...list].sort(by[sort]);
  }, [items, query, sort]);

  async function exportItems(ids: { type: string; id: string }[]) {
    const res = await fetch("/api/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items: ids }),
    });
    if (!res.ok) return toast.error("Export failed");
    await downloadBlob(res, "animachat-bundle.zip");
  }

  async function deleteItem(item: any) {
    if (!(await confirmDialog({ title: `Delete ${tab}`, message: `Delete "${item.name}"?`, confirmLabel: "Delete", danger: true }))) return;
    try {
      await api.del(`${type.endpoint}/${item.id}`);
      mutate();
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
            onChange={setTab}
          />
          <Button variant="secondary" onClick={() => importRef.current?.click()}>
            <Upload /> Import
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setExportSel([]);
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
        </div>

        {items?.length === 0 && (
          <EmptyState>
            No {type.label.toLowerCase()} yet — create one, or import a bundle. The AI co-writer in
            the editor can help you flesh it out.
          </EmptyState>
        )}
        {items && items.length > 0 && shown.length === 0 && (
          <EmptyState>Nothing matches “{query.trim()}”.</EmptyState>
        )}

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {shown.map((item) => (
            <Card
              key={item.id}
              item={item}
              onOpen={() => setEditing(item)}
              onExport={() => exportItems([{ type: tab, id: item.id }])}
              onDelete={() => deleteItem(item)}
            />
          ))}
        </div>
      </div>

      <GuideDialog open={guideOpen} onClose={() => setGuideOpen(false)} />

      <LibraryPicker
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        title="Export library items"
        hint="Check items across any types — everything is bundled into a single zip with its assets."
        selection={exportSel}
        onChange={setExportSel}
        footer={
          <>
            <Button variant="secondary" onClick={() => setExportOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!exportSel.length || exporting}
              onClick={async () => {
                setExporting(true);
                try {
                  await exportItems(exportSel.map(({ type, id }) => ({ type, id })));
                  setExportOpen(false);
                } finally {
                  setExporting(false);
                }
              }}
            >
              <Download />{" "}
              {exporting
                ? "Exporting…"
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
              mutate();
            }}
          />
        )}
      </Modal>

      <input
        ref={importRef}
        type="file"
        hidden
        accept=".zip"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          const fd = new FormData();
          fd.append("file", f);
          const res = await fetch("/api/import", { method: "POST", body: fd });
          const data = await res.json();
          if (!res.ok) return toast.error(data?.error ?? "Import failed");
          toast.success(
            "Imported: " +
              (Object.entries(data.imported ?? {})
                .map(([k, v]) => `${v} ${k}(s)`)
                .join(", ") || "nothing")
          );
          mutate();
        }}
      />
    </div>
  );
}
