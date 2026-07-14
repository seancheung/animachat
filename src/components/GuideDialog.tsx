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
  story: [
    { key: "description", label: "Premise", rows: 3 },
    { key: "destination", label: "Destination", rows: 1 },
  ],
  lorebook: [{ key: "description", label: "Description", rows: 2 }],
};

// dependencies first: locations before the scenes that name them; scenes, characters
// and lorebooks before the stories that reference all three
const SAVE_ORDER = ["location", "scene", "character", "lorebook", "story", "persona"];

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
      const [locs, scenes, chars, lores] = await Promise.all([
        api.get("/api/locations"),
        api.get("/api/scenes"),
        api.get("/api/characters"),
        api.get("/api/lorebooks"),
      ]);
      const norm = (n: unknown) => String(n ?? "").trim().toLowerCase();
      const locIds = new Map<string, string>(locs.map((l: any) => [norm(l.name), l.id]));
      const sceneIds = new Map<string, string>(scenes.map((s: any) => [norm(s.name), s.id]));
      const charIds = new Map<string, string>(chars.map((c: any) => [norm(c.name), c.id]));
      const loreIds = new Map<string, string>(lores.map((l: any) => [norm(l.name), l.id]));
      let saved = 0;
      for (const type of SAVE_ORDER) {
        for (const item of items.filter((i) => i.type === type)) {
          const payload: any = { ...item };
          delete payload.type;
          if (type === "scene") {
            payload.locationId = locIds.get(norm(payload.locationName)) || null;
            delete payload.locationName;
          }
          if (type === "story") {
            payload.characterIds = (Array.isArray(payload.castNames) ? payload.castNames : [])
              .map((n: unknown) => charIds.get(norm(n)))
              .filter(Boolean);
            payload.scenes = (Array.isArray(payload.scenes) ? payload.scenes : [])
              .map((e: any) => {
                const sceneId = sceneIds.get(norm(e?.sceneName));
                if (!sceneId) return null;
                const cast = (Array.isArray(e?.castNames) ? e.castNames : [])
                  .map((n: unknown) => charIds.get(norm(n)))
                  .filter((cid: any) => cid && payload.characterIds.includes(cid));
                return {
                  sceneId,
                  cast,
                  goal: typeof e?.goal === "string" ? e.goal : "",
                  obstacles: typeof e?.obstacles === "string" ? e.obstacles : "",
                  exit: typeof e?.exit === "string" ? e.exit : "",
                };
              })
              .filter(Boolean);
            // secret holders link by name, like the cast
            payload.secrets = (Array.isArray(payload.secrets) ? payload.secrets : [])
              .filter((s: any) => s && typeof s === "object")
              .map((s: any) => ({
                id: typeof s.id === "string" && s.id ? s.id : crypto.randomUUID(),
                title: String(s.title ?? ""),
                content: String(s.content ?? ""),
                knownBy: (Array.isArray(s.knownByNames) ? s.knownByNames : [])
                  .map((n: unknown) => charIds.get(norm(n)))
                  .filter((cid: any) => cid && payload.characterIds.includes(cid)),
                revealHint: String(s.revealHint ?? ""),
              }));
            payload.lorebookIds = (Array.isArray(payload.lorebookNames) ? payload.lorebookNames : [])
              .map((n: unknown) => loreIds.get(norm(n)))
              .filter(Boolean);
            delete payload.castNames;
            delete payload.lorebookNames;
            delete payload.sceneNames; // legacy field name, just in case
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
    <Modal open={open} onClose={onClose} title="Library guide" wide dismissable={false}>
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
                    the main characters, locations and a story with scenes from this novel&quot;.
                  </li>
                  <li>
                    Refine through chat or edit any field directly; remove items you don&apos;t
                    want.
                  </li>
                  <li>
                    Scenes link to locations — and stories to their cast, scenes and lorebooks —
                    by name on save.
                  </li>
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
          onRestore={(f) => setItems(Array.isArray(f.items) ? (f.items as GuideItem[]) : [])}
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
          <>
            <Field label="Cast (names in order, comma-separated)" hint="linked by name on save">
              <Input
                className="w-full"
                value={Array.isArray(item.castNames) ? item.castNames.join(", ") : ""}
                onChange={(v) =>
                  onChange({ castNames: v.split(",").map((s) => s.trim()).filter(Boolean) })
                }
              />
            </Field>
            <Field
              label="Scenes (names in order, comma-separated)"
              hint="linked by name on save; each scene keeps its on-stage cast — new names default to the full cast"
            >
              <Input
                className="w-full"
                value={
                  Array.isArray(item.scenes)
                    ? item.scenes.map((e: any) => e?.sceneName).filter(Boolean).join(", ")
                    : ""
                }
                onChange={(v) => {
                  const names = v.split(",").map((s) => s.trim()).filter(Boolean);
                  const prev: any[] = Array.isArray(item.scenes) ? item.scenes : [];
                  onChange({
                    scenes: names.map(
                      (n) =>
                        prev.find((p) => String(p?.sceneName ?? "").toLowerCase() === n.toLowerCase()) ?? {
                          sceneName: n,
                          castNames: Array.isArray(item.castNames) ? item.castNames : [],
                        }
                    ),
                  });
                }}
              />
            </Field>
            {Array.isArray(item.scenes) && item.scenes.some((e: any) => e?.castNames?.length) && (
              <div className="text-xs text-content-400">
                {item.scenes
                  .map((e: any) => `${e?.sceneName}: ${(e?.castNames ?? []).join(", ") || "(empty stage)"}`)
                  .join(" · ")}
              </div>
            )}
            <Field label="Lorebooks (names, comma-separated)" hint="linked by name on save">
              <Input
                className="w-full"
                value={Array.isArray(item.lorebookNames) ? item.lorebookNames.join(", ") : ""}
                onChange={(v) =>
                  onChange({ lorebookNames: v.split(",").map((s) => s.trim()).filter(Boolean) })
                }
              />
            </Field>
          </>
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
