"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  Clapperboard,
  Coffee,
  Folder,
  MapPin,
  Plus,
  ScrollText,
  Trash2,
} from "lucide-react";
import { ModelPicker } from "@/components/ModelPicker";
import { EmptyState, Field, Modal } from "@/components/ui";
import { api, assetUrl, cls } from "@/lib/ui";
import { POV_LABELS, type ChatMode } from "@/lib/types";

/* eslint-disable @typescript-eslint/no-explicit-any */

const MODES: { key: ChatMode; label: string; icon: React.ReactNode; hint: string }[] = [
  { key: "casual", label: "Casual", icon: <Coffee size={14} />, hint: "no story, scene or location" },
  { key: "story", label: "Story", icon: <BookOpen size={14} />, hint: "follow a story; switch between its scenes" },
  { key: "scene", label: "Scene", icon: <Clapperboard size={14} />, hint: "one fixed scene" },
  { key: "location", label: "Location", icon: <MapPin size={14} />, hint: "one fixed location" },
];

function NewChatWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { data: characters } = useSWR<any[]>("/api/characters", api.get);
  const { data: personas } = useSWR<any[]>("/api/personas", api.get);
  const { data: stories } = useSWR<any[]>("/api/stories", api.get);
  const { data: scenes } = useSWR<any[]>("/api/scenes", api.get);
  const { data: locations } = useSWR<any[]>("/api/locations", api.get);
  const { data: lorebooks } = useSWR<any[]>("/api/lorebooks", api.get);
  const [form, setForm] = useState<any>({
    mode: "casual",
    characterIds: [],
    personaId: null,
    storyId: null,
    sceneId: null,
    locationId: null,
    lorebookIds: [],
    narratorEnabled: false,
    modelId: null,
    language: "",
    pov: "",
  });
  const [busy, setBusy] = useState(false);

  const toggleCharacter = (id: string) => {
    const cur: string[] = form.characterIds;
    setForm({
      ...form,
      characterIds: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
    });
  };
  const toggleLorebook = (id: string) => {
    const cur: string[] = form.lorebookIds;
    setForm({ ...form, lorebookIds: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
  };
  const moveCharacter = (i: number, d: number) => {
    const next = [...form.characterIds];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setForm({ ...form, characterIds: next });
  };

  const story = stories?.find((s) => s.id === form.storyId);
  const storyScenes: any[] = story
    ? story.sceneIds.map((sid: string) => scenes?.find((s) => s.id === sid)).filter(Boolean)
    : [];
  const modeValid =
    form.mode === "casual" ||
    (form.mode === "story" && form.storyId) ||
    (form.mode === "scene" && form.sceneId) ||
    (form.mode === "location" && form.locationId);
  const charById = (id: string) => characters?.find((c) => c.id === id);

  return (
    <Modal open={open} onClose={onClose} title="New chat" wide>
      <div className="space-y-4">
        <Field label="Characters" hint="pick one or more — multiple = group chat with orchestrated turns">
          <div className="grid grid-cols-4 md:grid-cols-6 gap-2">
            {characters?.map((c) => {
              const idx = form.characterIds.indexOf(c.id);
              return (
                <button
                  key={c.id}
                  className={cls(
                    "panel overflow-hidden text-left transition-colors relative",
                    idx !== -1 && "border-[var(--accent)] ring-1 ring-[var(--accent)]"
                  )}
                  onClick={() => toggleCharacter(c.id)}
                >
                  {idx !== -1 && (
                    <span className="absolute top-1 left-1 z-10 w-5 h-5 rounded-full bg-[var(--accent)] text-black text-xs flex items-center justify-center font-bold">
                      {idx + 1}
                    </span>
                  )}
                  {c.sprites?.neutral || c.avatarAsset ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={assetUrl(c.sprites?.neutral ?? c.avatarAsset)!} alt="" className="w-full aspect-[2/3] object-cover" />
                  ) : (
                    <div className="w-full aspect-[2/3] flex items-center justify-center text-2xl bg-[var(--bg-soft)]">🎭</div>
                  )}
                  <div className="text-xs p-1.5 truncate">{c.name}</div>
                </button>
              );
            })}
            {characters?.length === 0 && (
              <div className="col-span-full text-sm text-[var(--text-dim)]">No characters yet — create one in the Library first.</div>
            )}
          </div>
        </Field>

        {form.characterIds.length > 1 && (
          <Field
            label="Character order"
            hint="[char_name] resolves to #1, [char_2_name] to #2… — fixed once the chat is created"
          >
            <div className="space-y-1">
              {form.characterIds.map((id: string, i: number) => (
                <div key={id} className="flex items-center gap-2 bg-[var(--bg-soft)] rounded-lg px-3 py-1 text-sm">
                  <span className="text-[var(--text-dim)] w-5">{i + 1}.</span>
                  <span className="flex-1">{charById(id)?.name ?? "?"}</span>
                  <button className="btn btn-sm btn-ghost" onClick={() => moveCharacter(i, -1)}><ArrowUp size={13} /></button>
                  <button className="btn btn-sm btn-ghost" onClick={() => moveCharacter(i, 1)}><ArrowDown size={13} /></button>
                </div>
              ))}
            </div>
          </Field>
        )}

        <Field label="Chat mode">
          <div className="flex gap-1 flex-wrap">
            {MODES.map((m) => (
              <button
                key={m.key}
                title={m.hint}
                className={cls("btn btn-sm", form.mode === m.key && "btn-primary")}
                onClick={() => setForm({ ...form, mode: m.key, storyId: null, sceneId: null, locationId: null })}
              >
                {m.icon} {m.label}
              </button>
            ))}
          </div>
          <div className="text-xs text-[var(--text-dim)] mt-1">{MODES.find((m) => m.key === form.mode)?.hint}</div>
        </Field>

        <div className="grid md:grid-cols-3 gap-3">
          {form.mode === "story" && (
            <>
              <Field label="Story (required)">
                <select className="input" value={form.storyId ?? ""} onChange={(e) => setForm({ ...form, storyId: e.target.value || null, sceneId: null })}>
                  <option value="">choose…</option>
                  {stories?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
              {storyScenes.length > 0 && (
                <Field label="Starting scene">
                  <select className="input" value={form.sceneId ?? ""} onChange={(e) => setForm({ ...form, sceneId: e.target.value || null })}>
                    <option value="">1. {storyScenes[0]?.name} (first)</option>
                    {storyScenes.map((s, i) => (
                      <option key={s.id} value={s.id}>{i + 1}. {s.name}</option>
                    ))}
                  </select>
                </Field>
              )}
            </>
          )}
          {form.mode === "scene" && (
            <Field label="Scene (required)" hint="fixed for the whole chat">
              <select className="input" value={form.sceneId ?? ""} onChange={(e) => setForm({ ...form, sceneId: e.target.value || null })}>
                <option value="">choose…</option>
                {scenes?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
          )}
          {form.mode === "location" && (
            <Field label="Location (required)" hint="fixed for the whole chat">
              <select className="input" value={form.locationId ?? ""} onChange={(e) => setForm({ ...form, locationId: e.target.value || null })}>
                <option value="">choose…</option>
                {locations?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </Field>
          )}
          <Field label="Your persona">
            <select className="input" value={form.personaId ?? ""} onChange={(e) => setForm({ ...form, personaId: e.target.value || null })}>
              <option value="">(none)</option>
              {personas?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Model">
            <ModelPicker value={form.modelId} onChange={(v) => setForm({ ...form, modelId: v })} />
          </Field>
          <Field label="Narrator">
            <select className="input" value={form.narratorEnabled ? "on" : "off"} onChange={(e) => setForm({ ...form, narratorEnabled: e.target.value === "on" })}>
              <option value="off">Disabled</option>
              <option value="on">Enabled — narration & suggested actions</option>
            </select>
          </Field>
          <Field label="Language override">
            <input className="input" placeholder="(global default)" value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })} />
          </Field>
          <Field label="POV override">
            <select className="input" value={form.pov} onChange={(e) => setForm({ ...form, pov: e.target.value })}>
              <option value="">(global default)</option>
              {Object.entries(POV_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Lorebooks">
            <div className="flex flex-wrap gap-1">
              {lorebooks?.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  className={cls("chip cursor-pointer", form.lorebookIds.includes(l.id) && "border-[var(--accent)] text-[var(--accent)]")}
                  onClick={() => toggleLorebook(l.id)}
                >
                  {l.name}
                </button>
              ))}
              {lorebooks?.length === 0 && <span className="text-xs text-[var(--text-dim)]">none</span>}
            </div>
          </Field>
        </div>
        <button
          className="btn btn-primary"
          disabled={busy || !modeValid || (!form.characterIds.length && !form.narratorEnabled)}
          onClick={async () => {
            setBusy(true);
            try {
              const chat = await api.post("/api/chats", form);
              router.push(`/chat/${chat.id}`);
            } catch (e: any) {
              alert(e.message);
              setBusy(false);
            }
          }}
        >
          {busy ? "Creating…" : "Start chat"}
        </button>
      </div>
    </Modal>
  );
}

export default function HomePage() {
  const router = useRouter();
  const { data: chats, mutate } = useSWR<any[]>("/api/chats", api.get);
  const [wizard, setWizard] = useState(false);
  const [q, setQ] = useState("");
  const [folder, setFolder] = useState<string>("");
  const { data: searchResults } = useSWR<any[]>(q.trim() ? `/api/search?q=${encodeURIComponent(q)}` : null, api.get);

  const folders = useMemo(() => [...new Set((chats ?? []).map((c) => c.folder).filter(Boolean))].sort(), [chats]);
  const visible = (chats ?? []).filter((c) => !folder || c.folder === folder);
  const modeIcon = (m: string) => MODES.find((x) => x.key === m)?.icon ?? null;

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto p-6 space-y-4">
        <div className="flex items-center gap-2">
          <input className="input" placeholder="Search all chats…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn btn-primary whitespace-nowrap" onClick={() => setWizard(true)}>
            <Plus size={15} /> New chat
          </button>
        </div>

        {folders.length > 0 && (
          <div className="flex gap-1 flex-wrap">
            <button className={cls("chip cursor-pointer", !folder && "text-[var(--accent)] border-[var(--accent)]")} onClick={() => setFolder("")}>
              all
            </button>
            {folders.map((f) => (
              <button key={f} className={cls("chip cursor-pointer", folder === f && "text-[var(--accent)] border-[var(--accent)]")} onClick={() => setFolder(f)}>
                <Folder size={11} /> {f}
              </button>
            ))}
          </div>
        )}

        {q.trim() ? (
          <div className="space-y-2">
            <div className="text-xs uppercase tracking-wider text-[var(--text-dim)]">Search results</div>
            {searchResults?.map((r) => (
              <div key={r.messageId} className="panel p-3 cursor-pointer hover:border-[var(--accent)]" onClick={() => router.push(`/chat/${r.chatId}`)}>
                <div className="text-sm font-medium">{r.chatTitle}</div>
                <div className="text-xs text-[var(--text-dim)] mt-1">{r.snippet}</div>
              </div>
            ))}
            {searchResults?.length === 0 && <EmptyState>No matches.</EmptyState>}
          </div>
        ) : (
          <div className="space-y-2">
            {chats?.length === 0 && (
              <EmptyState>
                Welcome to AnimaChat ✦ Set up a provider in Settings, create a character in the
                Library, then start your first chat.
              </EmptyState>
            )}
            {visible.map((c) => (
              <div key={c.id} className="panel p-3 cursor-pointer hover:border-[var(--accent)] transition-colors group" onClick={() => router.push(`/chat/${c.id}`)}>
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium truncate flex items-center gap-2">
                    <span className="text-[var(--text-dim)]">{modeIcon(c.mode)}</span>
                    {c.title}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {c.tags?.map((t: string) => <span key={t} className="chip">{t}</span>)}
                    <span className="text-xs text-[var(--text-dim)]">{c.messageCount} msgs</span>
                    <button
                      className="btn btn-sm btn-ghost opacity-0 group-hover:opacity-100"
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (confirm(`Delete chat "${c.title}"?`)) {
                          await api.del(`/api/chats/${c.id}`);
                          mutate();
                        }
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                <div className="text-xs text-[var(--text-dim)] mt-1 truncate flex items-center gap-1">
                  {c.characterNames.join(", ")}
                  {c.narratorEnabled && <ScrollText size={11} />}
                  {c.lastMessage && ` — ${c.lastMessage}`}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <NewChatWizard open={wizard} onClose={() => setWizard(false)} />
    </div>
  );
}
