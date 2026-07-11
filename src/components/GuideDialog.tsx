"use client";

import { useState } from "react";
import { mutate } from "swr";
import { Trash2 } from "lucide-react";
import { AssistPanel } from "@/components/AssistPanel";
import { Field, Modal } from "@/components/app";
import { LIBRARY_TYPES, libraryTypeIcon } from "@/components/LibraryPicker";
import Badge from "@/components/ui/badge";
import Button from "@/components/ui/button";
import Input from "@/components/ui/input";
import Textarea from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/ui";

/* eslint-disable @typescript-eslint/no-explicit-any */

type GuideItem = { type: string; name?: string; [key: string]: any };

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
  story: [{ key: "description", label: "Description", rows: 3 }],
  lorebook: [{ key: "description", label: "Description", rows: 2 }],
};

// locations before the scenes that name them, scenes before the stories that order them
const SAVE_ORDER = ["location", "scene", "story", "character", "persona", "lorebook"];

/**
 * Library guide: a co-writer session that creates a whole batch of library items
 * (any mix of types) shown as editable forms; Save persists them all, resolving
 * scene→location and story→scene links by name.
 */
export function GuideDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [items, setItems] = useState<GuideItem[]>([]);
  const [saving, setSaving] = useState(false);

  /** Merge a `{items:[…]}` payload from the co-writer: (type, name) identifies an item. */
  const applyFields = (partial: Record<string, unknown>) => {
    const incoming = partial.items;
    if (!Array.isArray(incoming)) return;
    setItems((prev) => {
      const next = [...prev];
      for (const raw of incoming) {
        if (!raw || typeof raw !== "object") continue;
        const it = raw as GuideItem;
        const type = String(it.type ?? "");
        const name = String(it.name ?? "").trim();
        if (!TEXT_FIELDS[type] || !name) continue;
        const idx = next.findIndex(
          (x) => x.type === type && String(x.name ?? "").toLowerCase() === name.toLowerCase()
        );
        if (idx === -1) next.push({ ...it, type });
        else next[idx] = { ...next[idx], ...it };
      }
      return next;
    });
  };

  async function saveAll() {
    if (!items.length || saving) return;
    setSaving(true);
    try {
      const [locs, scenes] = await Promise.all([
        api.get("/api/locations"),
        api.get("/api/scenes"),
      ]);
      const locIds = new Map<string, string>(locs.map((l: any) => [l.name.toLowerCase(), l.id]));
      const sceneIds = new Map<string, string>(scenes.map((s: any) => [s.name.toLowerCase(), s.id]));
      let saved = 0;
      for (const type of SAVE_ORDER) {
        for (const item of items.filter((i) => i.type === type)) {
          const payload: any = { ...item };
          delete payload.type;
          if (type === "scene") {
            const ln = String(payload.locationName ?? "").trim().toLowerCase();
            payload.locationId = (ln && locIds.get(ln)) || null;
            delete payload.locationName;
          }
          if (type === "story") {
            payload.sceneIds = (Array.isArray(payload.sceneNames) ? payload.sceneNames : [])
              .map((n: unknown) => sceneIds.get(String(n).trim().toLowerCase()))
              .filter(Boolean);
            delete payload.sceneNames;
          }
          const res = await api.post(ENDPOINT[type], payload);
          if (type === "location") locIds.set(String(res.name).toLowerCase(), res.id);
          if (type === "scene") sceneIds.set(String(res.name).toLowerCase(), res.id);
          saved++;
        }
      }
      toast.success(`Saved ${saved} item${saved === 1 ? "" : "s"} to the library`);
      setItems([]);
      for (const t of LIBRARY_TYPES) void mutate(t.url);
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
    <Modal open={open} onClose={onClose} title="Library guide" wide>
      <div className="grid grid-cols-[1fr_320px] gap-4 h-[70vh]">
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
                    the main characters, locations and a story with scenes from this novel&quot;.
                  </li>
                  <li>
                    Refine through chat or edit any field directly; remove items you don&apos;t
                    want.
                  </li>
                  <li>Scenes link to locations, and stories to their scenes, by name on save.</li>
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
          allowFiles
          emptyHint="Tell me what to build — a single item or a whole cast. Attach a .txt/.md file (file button) to extract characters, places, scenes, stories or lore from it."
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
  item: GuideItem;
  onChange: (patch: Record<string, unknown>) => void;
  onRemove: () => void;
}) {
  const Icon = libraryTypeIcon(item.type);
  return (
    <details className="panel overflow-hidden">
      <summary className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none list-none">
        <Icon size={14} className="shrink-0 text-content-300" />
        <span className="text-sm font-medium truncate flex-1">{item.name || "(unnamed)"}</span>
        <Badge variant="secondary" rounded>
          {item.type}
        </Badge>
        <Button
          variant="ghost"
          size="sm"
          shape="square"
          title="Remove from this batch"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRemove();
          }}
        >
          <Trash2 />
        </Button>
      </summary>
      <div className="px-3 pb-3 pt-2 space-y-2 border-t border-base-300">
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
        {item.type === "story" && (
          <Field label="Scenes (names in order, comma-separated)" hint="linked by name on save">
            <Input
              className="w-full"
              value={Array.isArray(item.sceneNames) ? item.sceneNames.join(", ") : ""}
              onChange={(v) =>
                onChange({ sceneNames: v.split(",").map((s) => s.trim()).filter(Boolean) })
              }
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
    </details>
  );
}
