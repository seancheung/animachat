"use client";

import { useRef, useState } from "react";
import useSWR from "swr";
import { CharacterEditor } from "@/components/editors/CharacterEditor";
import {
  LocationEditor,
  LorebookEditor,
  PersonaEditor,
  SceneEditor,
  StoryEditor,
} from "@/components/editors/SimpleEditors";
import { EmptyState, Modal } from "@/components/ui";
import { api, assetUrl, cls, downloadBlob } from "@/lib/ui";

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

function cardMeta(type: TypeKey, item: any): { img: string | null; sub: string } {
  switch (type) {
    case "character":
      return {
        img: assetUrl(item.sprites?.neutral ?? item.avatarAsset),
        sub: item.personality?.slice(0, 90) ?? "",
      };
    case "location":
    case "scene":
      return { img: assetUrl(item.artworkAsset), sub: (item.description ?? item.setup ?? "").slice(0, 90) };
    case "story":
      return { img: null, sub: `${item.sceneIds?.length ?? 0} scenes — ${(item.description ?? "").slice(0, 70)}` };
    case "lorebook":
      return { img: null, sub: `${item.entries?.length ?? 0} entries — ${(item.description ?? "").slice(0, 70)}` };
    default:
      return { img: null, sub: (item.description ?? "").slice(0, 90) };
  }
}

export default function LibraryPage() {
  const [tab, setTab] = useState<TypeKey>("character");
  const [editing, setEditing] = useState<any | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const importRef = useRef<HTMLInputElement>(null);

  const type = TYPES.find((t) => t.key === tab)!;
  const { data: items, mutate } = useSWR<any[]>(type.endpoint, api.get);
  const Editor = EDITORS[tab];

  async function exportItems(ids: { type: string; id: string }[]) {
    const res = await fetch("/api/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items: ids }),
    });
    if (!res.ok) return alert("Export failed");
    await downloadBlob(res, "animachat-bundle.zip");
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto p-6 space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          {TYPES.map((t) => (
            <button
              key={t.key}
              className={cls("btn btn-sm", tab === t.key && "btn-primary")}
              onClick={() => {
                setTab(t.key);
                setSelected(new Set());
                setSelectMode(false);
              }}
            >
              {t.label}
            </button>
          ))}
          <div className="flex-1" />
          <button className="btn btn-sm" onClick={() => importRef.current?.click()}>
            ⬆ Import bundle
          </button>
          {selectMode ? (
            <>
              <button
                className="btn btn-sm btn-primary"
                disabled={!selected.size}
                onClick={() => exportItems([...selected].map((id) => ({ type: tab, id })))}
              >
                ⬇ Export {selected.size} selected
              </button>
              <button className="btn btn-sm" onClick={() => setSelectMode(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button className="btn btn-sm" onClick={() => setSelectMode(true)}>
              Select…
            </button>
          )}
          <button className="btn btn-sm btn-primary" onClick={() => setEditing({})}>
            + New
          </button>
        </div>

        {items?.length === 0 && (
          <EmptyState>
            No {type.label.toLowerCase()} yet — create one, or import a bundle. The AI co-writer in
            the editor can help you flesh it out.
          </EmptyState>
        )}

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {items?.map((item) => {
            const meta = cardMeta(tab, item);
            return (
              <div
                key={item.id}
                className={cls(
                  "panel overflow-hidden cursor-pointer hover:border-[var(--accent)] transition-colors relative",
                  selectMode && selected.has(item.id) && "border-[var(--accent)]"
                )}
                onClick={() => {
                  if (selectMode) {
                    const next = new Set(selected);
                    if (next.has(item.id)) next.delete(item.id);
                    else next.add(item.id);
                    setSelected(next);
                  } else setEditing(item);
                }}
              >
                {selectMode && (
                  <div className="absolute top-2 left-2 z-10 text-lg">
                    {selected.has(item.id) ? "☑" : "☐"}
                  </div>
                )}
                {meta.img ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={meta.img} alt="" className={cls("w-full object-cover", tab === "character" ? "aspect-[2/3]" : "aspect-video")} />
                ) : (
                  <div className={cls("w-full flex items-center justify-center text-3xl text-[var(--text-dim)] bg-[var(--bg-soft)]", tab === "character" ? "aspect-[2/3]" : "aspect-video")}>
                    {tab === "story" ? "📖" : tab === "lorebook" ? "📚" : tab === "persona" ? "🎭" : "🌄"}
                  </div>
                )}
                <div className="p-2.5">
                  <div className="font-medium text-sm truncate">{item.name}</div>
                  <div className="text-xs text-[var(--text-dim)] line-clamp-2 h-8">{meta.sub}</div>
                  <div className="flex gap-1 mt-1.5" onClick={(e) => e.stopPropagation()}>
                    <button className="btn btn-sm btn-ghost" title="Export" onClick={() => exportItems([{ type: tab, id: item.id }])}>
                      ⬇
                    </button>
                    <button
                      className="btn btn-sm btn-ghost"
                      title="Delete"
                      onClick={async () => {
                        if (confirm(`Delete "${item.name}"?`)) {
                          await api.del(`${type.endpoint}/${item.id}`);
                          mutate();
                        }
                      }}
                    >
                      🗑
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? `Edit ${editing.name}` : `New ${tab}`} wide>
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
          if (!res.ok) return alert(data?.error ?? "Import failed");
          alert(
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
