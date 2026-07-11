"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import {
  BookOpen,
  Clapperboard,
  Coffee,
  Folder,
  MapPin,
  Plus,
  ScrollText,
  Search,
  Trash2,
  VenetianMask,
} from "lucide-react";
import { ModelPicker } from "@/components/ModelPicker";
import { EmptyState, Field, Modal } from "@/components/app";
import { confirmDialog } from "@/components/confirm";
import Badge from "@/components/ui/badge";
import Button from "@/components/ui/button";
import Input from "@/components/ui/input";
import Select from "@/components/ui/select";
import Switch from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import Toggle, { ToggleGroup } from "@/components/ui/toggle";
import { api, assetUrl } from "@/lib/ui";
import { cn } from "@/utils/cn";
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
    greetings: true,
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
  const story = stories?.find((s) => s.id === form.storyId);
  const storyScenes: any[] = story
    ? story.sceneIds.map((sid: string) => scenes?.find((s) => s.id === sid)).filter(Boolean)
    : [];
  const modeValid =
    form.mode === "casual" ||
    (form.mode === "story" && form.storyId) ||
    (form.mode === "scene" && form.sceneId) ||
    (form.mode === "location" && form.locationId);

  return (
    <Modal open={open} onClose={onClose} title="New chat" wide>
      <div className="space-y-4">
        <Field
          label="Characters"
          hint="pick one or more in speaking order — multiple = group chat with orchestrated turns; [char_name] resolves to #1, [char2_name] to #2… — fixed once the chat is created"
        >
          <div className="grid grid-cols-4 md:grid-cols-6 gap-2">
            {characters?.map((c) => {
              const idx = form.characterIds.indexOf(c.id);
              return (
                <button
                  key={c.id}
                  className={cn(
                    "panel overflow-hidden text-left transition-colors relative cursor-pointer",
                    idx !== -1 ? "border-primary-500" : "hover:border-primary-500/50"
                  )}
                  onClick={() => toggleCharacter(c.id)}
                >
                  {idx !== -1 && (
                    <span className="absolute top-1 left-1 z-10 w-5 h-5 rounded-full bg-primary-500 text-primary-content text-xs flex items-center justify-center font-bold">
                      {idx + 1}
                    </span>
                  )}
                  {c.avatarAsset || c.sprites?.neutral ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={assetUrl(c.avatarAsset ?? c.sprites?.neutral)!}
                      alt=""
                      className={cn("w-full aspect-square object-cover", !c.avatarAsset && "object-top")}
                    />
                  ) : (
                    <div className="w-full aspect-square flex items-center justify-center text-content-300 bg-base-200"><VenetianMask size={28} /></div>
                  )}
                  <div className="text-xs p-1.5 truncate">{c.name}</div>
                </button>
              );
            })}
            {characters?.length === 0 && (
              <div className="col-span-full text-sm text-content-300">No characters yet — create one in the Library first.</div>
            )}
          </div>
        </Field>

        <Field label="Chat mode">
          <ToggleGroup
            className="gap-1.5"
            value={form.mode}
            onChange={(v) => v && setForm({ ...form, mode: v, storyId: null, sceneId: null, locationId: null })}
          >
            {MODES.map((m) => (
              <Toggle key={m.key} value={m.key} title={m.hint}>
                {m.icon} {m.label}
              </Toggle>
            ))}
          </ToggleGroup>
          <div className="text-xs text-content-400 mt-1">{MODES.find((m) => m.key === form.mode)?.hint}</div>
        </Field>

        <div className="grid md:grid-cols-3 gap-3">
          {form.mode === "story" && (
            <>
              <Field label="Story (required)">
                <Select
                  className="w-full"
                  value={form.storyId}
                  onChange={(v) => setForm({ ...form, storyId: v, sceneId: null })}
                  options={stories?.map((s) => ({ value: s.id, label: s.name })) ?? []}
                  placeholder="choose…"
                />
              </Field>
              {storyScenes.length > 0 && (
                <Field label="Starting scene">
                  <Select
                    className="w-full"
                    value={form.sceneId}
                    onChange={(v) => setForm({ ...form, sceneId: v })}
                    options={storyScenes.map((s, i) => ({ value: s.id, label: `${i + 1}. ${s.name}` }))}
                    placeholder={`1. ${storyScenes[0]?.name} (first)`}
                    clearable
                    onClear={() => setForm({ ...form, sceneId: null })}
                  />
                </Field>
              )}
            </>
          )}
          {form.mode === "scene" && (
            <Field label="Scene (required)" hint="fixed for the whole chat">
              <Select
                className="w-full"
                value={form.sceneId}
                onChange={(v) => setForm({ ...form, sceneId: v })}
                options={scenes?.map((s) => ({ value: s.id, label: s.name })) ?? []}
                placeholder="choose…"
              />
            </Field>
          )}
          {form.mode === "location" && (
            <Field label="Location (required)" hint="fixed for the whole chat">
              <Select
                className="w-full"
                value={form.locationId}
                onChange={(v) => setForm({ ...form, locationId: v })}
                options={locations?.map((l) => ({ value: l.id, label: l.name })) ?? []}
                placeholder="choose…"
              />
            </Field>
          )}
          <Field label="Your persona">
            <Select
              className="w-full"
              value={form.personaId}
              onChange={(v) => setForm({ ...form, personaId: v })}
              options={personas?.map((p) => ({ value: p.id, label: p.name })) ?? []}
              placeholder="(none)"
              clearable
              onClear={() => setForm({ ...form, personaId: null })}
            />
          </Field>
          <Field label="Model">
            <ModelPicker value={form.modelId} onChange={(v) => setForm({ ...form, modelId: v })} />
          </Field>
          <Field label="Language override">
            <Input className="w-full" placeholder="(global default)" value={form.language} onChange={(v) => setForm({ ...form, language: v })} />
          </Field>
          <Field label="POV override">
            <Select
              className="w-full"
              value={form.pov || null}
              onChange={(v) => setForm({ ...form, pov: v })}
              options={Object.entries(POV_LABELS).map(([k, v]) => ({ value: k, label: v }))}
              placeholder="(global default)"
              clearable
              onClear={() => setForm({ ...form, pov: "" })}
            />
          </Field>
          <Field label="Narrator" hint="narration & suggested actions">
            <Switch value={form.narratorEnabled} onChange={(v) => setForm({ ...form, narratorEnabled: v })} label={form.narratorEnabled ? "Enabled" : "Disabled"} className="h-8" />
          </Field>
          <Field label="Greetings" hint="disable to speak first yourself">
            <Switch value={form.greetings} onChange={(v) => setForm({ ...form, greetings: v })} label={form.greetings ? "Characters open the chat" : "You speak first"} className="h-8" />
          </Field>
          <Field label="Lorebooks">
            <div className="flex flex-wrap gap-1.5">
              {lorebooks?.map((l) => (
                <Toggle
                  key={l.id}
                  value={form.lorebookIds.includes(l.id)}
                  onChange={() => toggleLorebook(l.id)}
                >
                  {l.name}
                </Toggle>
              ))}
              {lorebooks?.length === 0 && <span className="text-xs text-content-400">none</span>}
            </div>
          </Field>
        </div>
        <Button
          disabled={busy || !modeValid || (!form.characterIds.length && !form.narratorEnabled)}
          onClick={async () => {
            setBusy(true);
            try {
              const chat = await api.post("/api/chats", form);
              router.push(`/chat/${chat.id}`);
            } catch (e: any) {
              toast.error(e.message);
              setBusy(false);
            }
          }}
        >
          {busy ? "Creating…" : "Start chat"}
        </Button>
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
          <Input
            className="flex-1"
            icon={<Search />}
            placeholder="Search all chats…"
            value={q}
            onChange={setQ}
          />
          <Button className="whitespace-nowrap" onClick={() => setWizard(true)}>
            <Plus /> New chat
          </Button>
        </div>

        {folders.length > 0 && (
          <ToggleGroup className="gap-1.5" value={folder} onChange={(v) => setFolder(v ?? "")}>
            <Toggle value="">
              all
            </Toggle>
            {folders.map((f) => (
              <Toggle key={f} value={f}>
                <Folder size={11} /> {f}
              </Toggle>
            ))}
          </ToggleGroup>
        )}

        {q.trim() ? (
          <div className="space-y-2">
            <div className="text-xs uppercase tracking-wider text-content-300">Search results</div>
            {searchResults?.map((r) => (
              <div key={r.messageId} className="panel p-3 cursor-pointer hover:border-primary-500 transition-colors" onClick={() => router.push(`/chat/${r.chatId}`)}>
                <div className="text-sm font-medium">{r.chatTitle}</div>
                <div className="text-xs text-content-300 mt-1">{r.snippet}</div>
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
              <div key={c.id} className="panel p-3 cursor-pointer hover:border-primary-500 transition-colors group" onClick={() => router.push(`/chat/${c.id}`)}>
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium truncate flex items-center gap-2">
                    <span className="text-content-300">{modeIcon(c.mode)}</span>
                    {c.title}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {c.tags?.map((t: string) => <Badge key={t} variant="secondary" rounded>{t}</Badge>)}
                    <span className="text-xs text-content-300">{c.messageCount} msgs</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      shape="square"
                      className="opacity-0 group-hover:opacity-100"
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (await confirmDialog({ title: "Delete chat", message: `Delete chat "${c.title}"?`, confirmLabel: "Delete", danger: true })) {
                          await api.del(`/api/chats/${c.id}`);
                          mutate();
                        }
                      }}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>
                <div className="text-xs text-content-300 mt-1 truncate flex items-center gap-1">
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
