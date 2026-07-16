"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { AssistPanel } from "@/components/AssistPanel";
import { Field, Modal } from "@/components/app";
import { LIBRARY_TYPES, libraryTypeIcon } from "@/components/LibraryPicker";
import Badge from "@/components/ui/badge";
import Button from "@/components/ui/button";
import Collapsible from "@/components/ui/collapsible";
import Input from "@/components/ui/input";
import Textarea from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { searchIdByName, useInvalidate } from "@/lib/queries";
import { api } from "@/lib/ui";

/* eslint-disable @typescript-eslint/no-explicit-any */

type AssistantItem = { type: string; name?: string; [key: string]: any };

const ENDPOINT: Record<string, string> = Object.fromEntries(
  LIBRARY_TYPES.map((t) => [t.type, t.url])
);

/** Editable text fields per type; anything else the AI sets rides along into the save payload. */
const TEXT_FIELDS: Record<string, { key: string; label: string; rows: number }[]> = {
  character: [
    { key: "description", label: "Description", rows: 5 },
    { key: "greeting", label: "Greeting", rows: 3 },
    { key: "exampleDialogue", label: "Example dialogue", rows: 3 },
    { key: "imagePrompt", label: "Image prompt", rows: 2 },
  ],
  persona: [{ key: "description", label: "Description", rows: 4 }],
  location: [
    { key: "description", label: "Description", rows: 4 },
    { key: "imagePrompt", label: "Image prompt", rows: 2 },
  ],
  scene: [
    { key: "setup", label: "Setup", rows: 4 },
    { key: "imagePrompt", label: "Image prompt", rows: 2 },
  ],
  lorebook: [{ key: "description", label: "Description", rows: 2 }],
};

// dependencies first: locations before the scenes that name them
// (stories are authored on the story page, not in the Assistant)
const SAVE_ORDER = ["location", "scene", "character", "lorebook", "persona"];

/**
 * Library assistant: a co-writer session that creates a whole batch of library items
 * (any mix of types) shown as editable forms; Save persists them all, resolving
 * scene→location and story→scene links by name.
 */
export function AssistantDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [items, setItems] = useState<AssistantItem[]>([]);
  const [saving, setSaving] = useState(false);
  const invalidate = useInvalidate();

  /** Merge a `{items:[…]}` payload from the co-writer: (type, name) identifies an item. */
  const applyFields = (partial: Record<string, unknown>) => {
    const incoming = partial.items;
    if (!Array.isArray(incoming)) return;
    setItems((prev) => {
      const next = [...prev];
      for (const raw of incoming) {
        if (!raw || typeof raw !== "object") continue;
        const it = raw as AssistantItem;
        const type = String(it.type ?? "");
        const name = String(it.name ?? "").trim();
        if (!TEXT_FIELDS[type] || !name) continue;
        const find = (n: string) =>
          next.findIndex(
            (x) => x.type === type && String(x.name ?? "").toLowerCase() === n.toLowerCase()
          );
        // a rename targets the item under its old name (falling back to the new one,
        // in case the model repeats a rename that already happened)
        const renameFrom = String(it.renameFrom ?? "").trim();
        let idx = renameFrom ? find(renameFrom) : -1;
        if (idx === -1) idx = find(name);
        const fields = { ...it };
        delete fields.renameFrom;
        if (idx === -1) next.push({ ...fields, type });
        else next[idx] = { ...next[idx], ...fields };
      }
      return next;
    });
  };

  async function saveAll() {
    if (!items.length || saving) return;
    setSaving(true);
    try {
      const norm = (n: unknown) => String(n ?? "").trim().toLowerCase();
      const locIds = new Map<string, string>();
      const sceneIds = new Map<string, string>();
      const charIds = new Map<string, string>();
      const loreIds = new Map<string, string>();
      const maps: Record<string, Map<string, string>> = {
        location: locIds,
        scene: sceneIds,
        character: charIds,
        lorebook: loreIds,
      };
      // resolve each referenced name once against the library; items saved from this
      // batch override these below as they are POSTed
      const resolve = async (type: string, name: unknown) => {
        const key = norm(name);
        if (!key || maps[type].has(key)) return;
        const id = await searchIdByName(type, name);
        if (id) maps[type].set(key, id);
      };
      const refs: [string, unknown][] = [];
      for (const item of items) {
        if (item.type === "scene" && item.locationName) refs.push(["location", item.locationName]);
      }
      await Promise.all(refs.map(([t, n]) => resolve(t, n)));
      let saved = 0;
      for (const type of SAVE_ORDER) {
        for (const item of items.filter((i) => i.type === type)) {
          const payload: any = { ...item };
          delete payload.type;
          if (type === "scene") {
            payload.locationId = locIds.get(norm(payload.locationName)) || null;
            delete payload.locationName;
          }
          const res = await api.post(ENDPOINT[type], payload);
          if (type === "location") locIds.set(norm(res.name), res.id);
          if (type === "scene") sceneIds.set(norm(res.name), res.id);
          if (type === "character") charIds.set(norm(res.name), res.id);
          if (type === "lorebook") loreIds.set(norm(res.name), res.id);
          saved++;
        }
      }
      toast.success(`Saved ${saved} item${saved === 1 ? "" : "s"} to the library`);
      setItems([]);
      void invalidate(...LIBRARY_TYPES.map((t) => t.url), "/api/library/tags", "/api/library/search");
      onClose();
    } catch (e) {
      // saves run one by one — earlier items may already be in the library
      toast.error(
        `${e instanceof Error ? e.message : String(e)} — some items may already have been saved; check the library before retrying`
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Library assistant" wide dismissable={false}>
      {/* minmax(0,1fr) row: keep both columns inside the 70vh box (see EditorShell) */}
      <div className="grid grid-cols-[1fr_320px] grid-rows-[minmax(0,1fr)] gap-4 h-[70vh]">
        <div className="flex flex-col min-h-0">
          <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-2">
            {items.length === 0 ? (
              <div className="text-sm text-content-300 leading-relaxed space-y-3 max-w-prose pt-1">
                <p>
                  Build a whole set of library items in one conversation with the co-writer — they
                  appear here as editable forms and are saved to your library together.
                </p>
                <ul className="list-disc pl-5 space-y-1.5 text-xs text-content-400">
                  <li>
                    Ask for a themed set: &quot;a rival guild — three members, their hideout, and a
                    lorebook of their rules&quot;.
                  </li>
                  <li>
                    Attach .txt/.md files with the file button and extract from them: &quot;create
                    the main characters and locations from this novel&quot;. (Stories are authored
                    on the Stories page, whose co-writer builds the whole story in one go.)
                  </li>
                  <li>
                    Refine through chat or edit any field directly; remove items you don&apos;t
                    want.
                  </li>
                  <li>Scenes link to locations by name on save.</li>
                </ul>
              </div>
            ) : (
              items.map((item, i) => (
                <ItemCard
                  key={`${item.type}:${item.name ?? i}`}
                  item={item}
                  onChange={(patch) =>
                    setItems(items.map((x, j) => (j === i ? { ...x, ...patch } : x)))
                  }
                  onRemove={() => setItems(items.filter((_, j) => j !== i))}
                />
              ))
            )}
          </div>
          <div className="pt-3 flex items-center gap-3">
            <Button disabled={!items.length || saving} onClick={saveAll}>
              {saving
                ? "Saving…"
                : `Save ${items.length || ""} item${items.length === 1 ? "" : "s"}`}
            </Button>
            {items.length > 0 && (
              <span className="text-xs text-content-400">
                nothing is persisted until you save
              </span>
            )}
          </div>
        </div>
        <AssistPanel
          entityType="library"
          fields={{ items }}
          onFields={applyFields}
          onRestore={(f) => setItems(Array.isArray(f.items) ? (f.items as AssistantItem[]) : [])}
          allowFiles
          emptyHint="Tell me what to build — a single item or a whole cast. Attach a .txt/.md file (file button) to extract characters, places, scenes or lore from it."
        />
      </div>
    </Modal>
  );
}

function ItemCard({
  item,
  onChange,
  onRemove,
}: {
  item: AssistantItem;
  onChange: (patch: Record<string, unknown>) => void;
  onRemove: () => void;
}) {
  const Icon = libraryTypeIcon(item.type);
  return (
    <Collapsible
      bordered
      title={
        <>
          <Icon size={14} className="shrink-0 text-content-300" />
          <span className="flex-1 truncate">{item.name || "(unnamed)"}</span>
          <Badge variant="secondary" rounded className="shrink-0">
            {item.type}
          </Badge>
        </>
      }
      chevron={() => (
        <span className="shrink-0 pr-3">
          <Button
            variant="ghost"
            size="sm"
            shape="square"
            title="Remove from this batch"
            onClick={onRemove}
          >
            <Trash2 />
          </Button>
        </span>
      )}
    >
      <div className="space-y-2">
        <Field label="Name">
          <Input className="w-full" value={item.name ?? ""} onChange={(v) => onChange({ name: v })} />
        </Field>
        {TEXT_FIELDS[item.type]?.map((f) => (
          <Field key={f.key} label={f.label}>
            <Textarea
              className="w-full"
              rows={f.rows}
              value={typeof item[f.key] === "string" ? item[f.key] : ""}
              onChange={(v) => onChange({ [f.key]: v })}
            />
          </Field>
        ))}
        {item.type === "scene" && (
          <Field label="Location (by name)" hint="linked to the location with this name on save">
            <Input
              className="w-full"
              value={item.locationName ?? ""}
              onChange={(v) => onChange({ locationName: v })}
            />
          </Field>
        )}
        {item.type === "lorebook" && Array.isArray(item.entries) && item.entries.length > 0 && (
          <div className="text-xs text-content-400">
            {item.entries.length} entr{item.entries.length === 1 ? "y" : "ies"}:{" "}
            {item.entries.map((e: any) => e?.title).filter(Boolean).join(", ")}
          </div>
        )}
        {item.type === "character" &&
          Array.isArray(item.customExpressions) &&
          item.customExpressions.length > 0 && (
            <div className="text-xs text-content-400">
              custom expressions:{" "}
              {item.customExpressions.map((e: any) => e?.name).filter(Boolean).join(", ")}
            </div>
          )}
      </div>
    </Collapsible>
  );
}
