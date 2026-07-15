"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import {
  BookOpen,
  Captions,
  Clapperboard,
  Coffee,
  Download,
  Folder,
  MapPin,
  PanelRight,
  Plus,
  ScrollText,
  Search,
  Trash2,
  Upload,
  UserRound,
  VenetianMask,
} from "lucide-react";
import { ModelPicker } from "@/components/ModelPicker";
import { EmptyState, Field, Modal } from "@/components/app";
import { confirmDialog } from "@/components/confirm";
import Badge from "@/components/ui/badge";
import Button from "@/components/ui/button";
import Combobox from "@/components/ui/combobox";
import Input from "@/components/ui/input";
import SegmentedControl from "@/components/ui/segmented-control";
import Select from "@/components/ui/select";
import Switch from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import Toggle, { ToggleGroup } from "@/components/ui/toggle";
import Tooltip from "@/components/ui/tooltip";
import { api, assetUrl, downloadBlob } from "@/lib/ui";
import { cn } from "@/utils/cn";
import { POV_LABELS, type ChatMode } from "@/lib/types";

/* eslint-disable @typescript-eslint/no-explicit-any */

const MODES: { key: ChatMode; label: string; icon: React.ReactNode; hint: string }[] = [
  {
    key: "casual",
    label: "Casual",
    icon: <Coffee size={14} />,
    hint: "free-form chat, no setting — characters optional when the narrator runs the show",
  },
  {
    key: "immersive",
    label: "Immersive",
    icon: <MapPin size={14} />,
    hint: "one fixed scene or location",
  },
  {
    key: "story",
    label: "Playthrough",
    icon: <BookOpen size={14} />,
    hint: "play through a story — its cast and scenes, directed by the narrator",
  },
];

const MODE_ICONS: Record<string, React.ReactNode> = {
  casual: <Coffee size={14} />,
  immersive: <MapPin size={14} />,
  story: <BookOpen size={14} />,
  // legacy modes (pre-playthrough data)
  scene: <Clapperboard size={14} />,
  location: <MapPin size={14} />,
};

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
    personaCharacterId: null,
    storyId: null,
    sceneId: null,
    locationId: null,
    lorebookIds: [],
    narratorEnabled: false,
    greetings: false,
    modelId: null,
    language: "",
    pov: "",
    layout: "panel",
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
  const storyCast: any[] = story
    ? story.characterIds.map((cid: string) => characters?.find((c) => c.id === cid)).filter(Boolean)
    : [];
  const storyScenes: any[] = story
    ? story.scenes.map((e: any) => scenes?.find((s) => s.id === e.sceneId)).filter(Boolean)
    : [];

  const settingOptions = [
    ...(scenes?.map((s) => ({ value: `scene:${s.id}`, label: s.name })) ?? []),
    ...(locations?.map((l) => ({ value: `location:${l.id}`, label: l.name })) ?? []),
  ].sort((a, b) => a.label.localeCompare(b.label));
  // typed option rows: the icon carries the entity type, so labels stay clean names
  const typedOption = (icons: Record<string, React.ReactNode>) =>
    function TypedOption(o: { value: string; label: string }) {
      return (
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className="shrink-0 text-content-300">{icons[o.value.split(":")[0]]}</span>
          <span className="truncate">{o.label}</span>
        </span>
      );
    };
  const settingOption = typedOption({ scene: <Clapperboard size={13} />, location: <MapPin size={13} /> });
  const playAsOption = typedOption({ char: <UserRound size={13} />, persona: <VenetianMask size={13} /> });

  const narrator = form.mode === "story" ? true : form.narratorEnabled;
  const modeValid =
    form.mode === "story"
      ? !!form.storyId
      : (form.mode === "casual" || form.sceneId || form.locationId) &&
        (form.characterIds.length > 0 || narrator);
  // greetings fit exactly one shape: a casual 1:1 with the narrator off
  const greetingsAvailable = form.mode === "casual" && form.characterIds.length === 1 && !narrator;

  return (
    <Modal open={open} onClose={onClose} title="New chat" wide>
      <div className="space-y-4">
        <Field label="Chat mode">
          <ToggleGroup
            className="gap-1.5"
            value={form.mode}
            onChange={(v) =>
              v &&
              setForm({
                ...form,
                mode: v,
                storyId: null,
                sceneId: null,
                locationId: null,
                personaCharacterId: null,
                characterIds: v === "story" ? [] : form.characterIds,
              })
            }
          >
            {MODES.map((m) => (
              // span target: Toggle spreads props onto its sr-only checkbox, which can't anchor a tooltip
              <Tooltip key={m.key} content={m.hint}>
                <span className="inline-flex">
                  <Toggle value={m.key}>
                    {m.icon} {m.label}
                  </Toggle>
                </span>
              </Tooltip>
            ))}
          </ToggleGroup>
          <div className="text-xs text-content-400 mt-1">{MODES.find((m) => m.key === form.mode)?.hint}</div>
        </Field>

        {form.mode !== "story" && (
          <Field
            label={form.mode === "casual" ? "Characters" : "Characters (required)"}
            hint="pick in speaking order — multiple = group chat with orchestrated turns; [char_name] resolves to #1, [char2_name] to #2… — fixed once the chat is created"
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
                      <div className="w-full aspect-square flex items-center justify-center text-content-300 bg-base-200">
                        <VenetianMask size={28} />
                      </div>
                    )}
                    <div className="text-xs p-1.5 truncate">{c.name}</div>
                  </button>
                );
              })}
              {characters?.length === 0 && (
                <div className="col-span-full text-sm text-content-300">
                  No characters yet — create one in the Library first.
                </div>
              )}
            </div>
          </Field>
        )}

        <div className="grid md:grid-cols-3 gap-3">
          {form.mode === "story" && (
            <>
              <Field label="Story (required)" hint="cast, scenes & lorebooks come from it — snapshotted at creation">
                <Combobox
                  className="w-full"
                  value={form.storyId}
                  onChange={(v) => setForm({ ...form, storyId: v, sceneId: null, personaCharacterId: null })}
                  options={stories?.map((s) => ({ value: s.id, label: s.name })) ?? []}
                  placeholder="choose…"
                />
              </Field>
              <Field label="Play as" hint="a cast member, or one of your personas">
                <Combobox
                  className="w-full"
                  value={
                    form.personaCharacterId
                      ? `char:${form.personaCharacterId}`
                      : form.personaId
                        ? `persona:${form.personaId}`
                        : null
                  }
                  onChange={(v) => {
                    const [kind, pid] = (v as string).split(":");
                    setForm({
                      ...form,
                      personaCharacterId: kind === "char" ? pid : null,
                      personaId: kind === "persona" ? pid : null,
                    });
                  }}
                  options={[
                    ...storyCast.map((c) => ({ value: `char:${c.id}`, label: c.name })),
                    ...(personas?.map((p) => ({ value: `persona:${p.id}`, label: p.name })) ?? []),
                  ]}
                  renderOption={playAsOption}
                  placeholder="(spectator)"
                  clearable
                  onClear={() => setForm({ ...form, personaCharacterId: null, personaId: null })}
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
          {form.mode === "immersive" && (
            <Field label="Setting (required)" hint="fixed for the whole chat">
              <Combobox
                className="w-full"
                value={
                  form.sceneId ? `scene:${form.sceneId}` : form.locationId ? `location:${form.locationId}` : null
                }
                onChange={(v) => {
                  const [kind, id] = (v as string).split(":");
                  setForm({ ...form, sceneId: kind === "scene" ? id : null, locationId: kind === "location" ? id : null });
                }}
                options={settingOptions}
                renderOption={settingOption}
                placeholder="choose a scene or location…"
              />
            </Field>
          )}
          {form.mode !== "story" && (
            <Field label="Your persona">
              <Combobox
                className="w-full"
                value={form.personaId}
                onChange={(v) => setForm({ ...form, personaId: v })}
                options={personas?.map((p) => ({ value: p.id, label: p.name })) ?? []}
                placeholder="(none)"
                clearable
                onClear={() => setForm({ ...form, personaId: null })}
              />
            </Field>
          )}
          <Field label="Model" hint="the one setting that stays editable later">
            <ModelPicker value={form.modelId} onChange={(v) => setForm({ ...form, modelId: v })} />
          </Field>
          <Field label="Language override">
            <Input
              className="w-full"
              placeholder="(global default)"
              value={form.language}
              onChange={(v) => setForm({ ...form, language: v })}
            />
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
          <Field label="Chat layout" hint="presentation only — switchable anytime in chat settings">
            <SegmentedControl
              className="w-full"
              size="sm"
              value={form.layout}
              onChange={(v) => setForm({ ...form, layout: v })}
              items={[
                { value: "panel", label: (<span className="inline-flex items-center gap-1.5"><PanelRight size={13} /> Side panel</span>) },
                { value: "dialogue", label: (<span className="inline-flex items-center gap-1.5"><Captions size={13} /> Dialogue box</span>) },
              ]}
            />
          </Field>
          <Field
            label="Narrator"
            hint={form.mode === "story" ? "always on — the narrator directs playthroughs" : "narration, suggested actions — speaks first"}
          >
            {form.mode === "story" ? (
              <div className="h-8 flex items-center text-sm text-content-300">
                <ScrollText size={14} className="mr-1.5" /> Enabled
              </div>
            ) : (
              <Switch
                value={form.narratorEnabled}
                onChange={(v) => setForm({ ...form, narratorEnabled: v })}
                label={form.narratorEnabled ? "Enabled" : "Disabled"}
                className="h-8"
              />
            )}
          </Field>
          {greetingsAvailable && (
            <Field label="Greeting" hint="the character opens with their greeting message">
              <Switch
                value={form.greetings}
                onChange={(v) => setForm({ ...form, greetings: v })}
                label={form.greetings ? "Character speaks first" : "You speak first"}
                className="h-8"
              />
            </Field>
          )}
          {form.mode !== "story" && (
            <Field label="Lorebooks">
              <div className="flex flex-wrap gap-1.5">
                {lorebooks?.map((l) => (
                  <Toggle key={l.id} value={form.lorebookIds.includes(l.id)} onChange={() => toggleLorebook(l.id)}>
                    {l.name}
                  </Toggle>
                ))}
                {lorebooks?.length === 0 && <span className="text-xs text-content-400">none</span>}
              </div>
            </Field>
          )}
        </div>
        <Button
          disabled={busy || !modeValid}
          onClick={async () => {
            setBusy(true);
            try {
              const chat = await api.post("/api/chats", {
                ...form,
                narratorEnabled: narrator,
                greetings: greetingsAvailable && form.greetings,
                overrides: form.layout === "dialogue" ? { layout: "dialogue" } : {},
              });
              router.push(`/chat/${chat.id}`);
            } catch (e: any) {
              toast.error(e.message);
              setBusy(false);
            }
          }}
        >
          {busy ? "Creating…" : form.mode === "story" ? "Start playthrough" : "Start chat"}
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
  const importRef = useRef<HTMLInputElement>(null);
  const { data: searchResults } = useSWR<any[]>(q.trim() ? `/api/search?q=${encodeURIComponent(q)}` : null, api.get);

  const folders = useMemo(() => [...new Set((chats ?? []).map((c) => c.folder).filter(Boolean))].sort(), [chats]);
  const visible = (chats ?? []).filter((c) => !folder || c.folder === folder);

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
          <Button
            variant="secondary"
            className="whitespace-nowrap"
            title="Import a chat archive (.zip)"
            onClick={() => importRef.current?.click()}
          >
            <Upload /> Import
          </Button>
          <Button className="whitespace-nowrap" onClick={() => setWizard(true)}>
            <Plus /> New chat
          </Button>
        </div>

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
            const res = await fetch("/api/chats/import", { method: "POST", body: fd });
            const data = await res.json();
            if (!res.ok) return toast.error(data?.error ?? "Import failed");
            await mutate();
            router.push(`/chat/${data.chat.id}`);
          }}
        />

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
                    <span className="text-content-300">{MODE_ICONS[c.mode] ?? null}</span>
                    {c.title}
                    {c.mode === "story" && c.storyName && (
                      <Badge variant="secondary" rounded>
                        Playthrough — {c.storyName}
                      </Badge>
                    )}
                    {c.ended && <Badge rounded>The End</Badge>}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {c.tags?.map((t: string) => <Badge key={t} variant="secondary" rounded>{t}</Badge>)}
                    <span className="text-xs text-content-300">{c.messageCount} msgs</span>
                    <span className="text-xs text-content-400">
                      {new Date(c.updatedAt).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      shape="square"
                      className="opacity-0 group-hover:opacity-100"
                      title="Export chat archive"
                      onClick={async (e) => {
                        e.stopPropagation();
                        await downloadBlob(await fetch(`/api/chats/${c.id}/archive`), "chat.zip");
                      }}
                    >
                      <Download />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      shape="square"
                      className="opacity-0 group-hover:opacity-100"
                      title="Delete chat"
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
