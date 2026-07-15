"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
import LoadMoreSentinel from "@/components/ui/load-more";
import MultiCombobox from "@/components/ui/multi-combobox";
import SegmentedControl from "@/components/ui/segmented-control";
import Select from "@/components/ui/select";
import Switch from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import Toggle, { ToggleGroup } from "@/components/ui/toggle";
import Tooltip from "@/components/ui/tooltip";
import { useComboboxSearch, useDebouncedValue, useGet, useInvalidate, usePagedList } from "@/lib/queries";
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

/** Chat-list timestamp: time for today, month+day this year, short date otherwise. */
function fmtWhen(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (d.getFullYear() === now.getFullYear())
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return d.toLocaleDateString(undefined, { dateStyle: "short" });
}


function NewChatWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const invalidate = useInvalidate();
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
  // server-searched pickers only hold the current result page — labels of picked ids
  // and the full cards of picked characters are kept locally so narrowing a search
  // (or paging) can never blank them out
  const [labels, setLabels] = useState<Record<string, string>>({});
  const remember = (id: string, label: string) =>
    setLabels((p) => (p[id] === label ? p : { ...p, [id]: label }));
  const [picked, setPicked] = useState<Record<string, any>>({});

  const [charQ, setCharQ] = useState("");
  const debouncedCharQ = useDebouncedValue(charQ.trim());
  const charList = usePagedList<any>(
    "/api/characters",
    { q: debouncedCharQ || undefined },
    { enabled: open && form.mode !== "story" }
  );
  const personaSearch = useComboboxSearch("/api/personas", {
    enabled: open,
    selected: form.personaId ? { value: form.personaId, label: labels[form.personaId] ?? "…" } : null,
  });
  const storySearch = useComboboxSearch("/api/stories", {
    enabled: open && form.mode === "story",
    selected: form.storyId ? { value: form.storyId, label: labels[form.storyId] ?? "…" } : null,
  });
  const sceneSearch = useComboboxSearch("/api/scenes", {
    enabled: open && form.mode === "immersive",
    toOption: (s: any) => ({ value: `scene:${s.id}`, label: s.name }),
  });
  const locSearch = useComboboxSearch("/api/locations", {
    enabled: open && form.mode === "immersive",
    toOption: (l: any) => ({ value: `location:${l.id}`, label: l.name }),
  });
  const loreSearch = useComboboxSearch("/api/lorebooks", { enabled: open && form.mode !== "story" });
  // the story's cast & scene names come from the decorated story GET, not the full lists
  const { data: storyDetail } = useGet<any>(`/api/stories/${form.storyId}`, {
    enabled: open && !!form.storyId,
  });
  const storyCast: { id: string; name: string }[] = storyDetail?.castRefs ?? [];
  const storyScenes: { id: string; name: string }[] = storyDetail?.sceneRefs ?? [];

  const toggleCharacter = (c: any) => {
    const cur: string[] = form.characterIds;
    if (!cur.includes(c.id)) setPicked((p) => ({ ...p, [c.id]: c }));
    setForm({
      ...form,
      characterIds: cur.includes(c.id) ? cur.filter((x) => x !== c.id) : [...cur, c.id],
    });
  };
  // picked characters render first (from their captured cards), the rest from the search page
  const gridItems: any[] = [
    ...form.characterIds.map((id: string) => picked[id]).filter(Boolean),
    ...charList.items.filter((c) => !form.characterIds.includes(c.id)),
  ];

  const settingValue = form.sceneId
    ? `scene:${form.sceneId}`
    : form.locationId
      ? `location:${form.locationId}`
      : null;
  const settingOptions = useMemo(() => {
    const out = [...sceneSearch.options, ...locSearch.options].sort((a, b) =>
      a.label.localeCompare(b.label)
    );
    if (settingValue && !out.some((o) => o.value === settingValue))
      out.unshift({ value: settingValue, label: labels[form.sceneId ?? form.locationId] ?? "…" });
    return out;
  }, [sceneSearch.options, locSearch.options, settingValue, labels, form.sceneId, form.locationId]);
  const loreOptions = useMemo(() => {
    const out = [...loreSearch.options];
    for (const id of form.lorebookIds as string[])
      if (!out.some((o) => o.value === id)) out.unshift({ value: id, label: labels[id] ?? "?" });
    return out;
  }, [loreSearch.options, form.lorebookIds, labels]);
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
            <Input
              className="w-full mb-2"
              icon={<Search />}
              placeholder="Search characters…"
              value={charQ}
              onChange={setCharQ}
            />
            <div className="grid grid-cols-4 md:grid-cols-6 gap-2">
              {gridItems.map((c) => {
                const idx = form.characterIds.indexOf(c.id);
                return (
                  <button
                    key={c.id}
                    className={cn(
                      "panel overflow-hidden text-left transition-colors relative cursor-pointer",
                      idx !== -1 ? "border-primary-500" : "hover:border-primary-500/50"
                    )}
                    onClick={() => toggleCharacter(c)}
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
              {!charList.isLoading && gridItems.length === 0 && (
                <div className="col-span-full text-sm text-content-300">
                  {debouncedCharQ
                    ? `Nothing matches “${debouncedCharQ}”.`
                    : "No characters yet — create one in the Library first."}
                </div>
              )}
            </div>
            <LoadMoreSentinel
              hasMore={!!charList.hasNextPage}
              isFetching={charList.isFetchingNextPage}
              onLoadMore={() => void charList.fetchNextPage()}
            />
          </Field>
        )}

        <div className="grid md:grid-cols-3 gap-3">
          {form.mode === "story" && (
            <>
              <Field label="Story (required)" hint="cast, scenes & lorebooks come from it — snapshotted at creation">
                <Combobox
                  className="w-full"
                  value={form.storyId}
                  onChange={(v) => {
                    if (v) {
                      const opt = storySearch.options.find((o) => o.value === v);
                      if (opt) remember(v, opt.label);
                    }
                    setForm({ ...form, storyId: v, sceneId: null, personaCharacterId: null });
                  }}
                  options={storySearch.options}
                  loading={storySearch.loading}
                  hasMore={storySearch.hasMore}
                  isFetchingMore={storySearch.isFetchingMore}
                  onLoadMore={storySearch.onLoadMore}
                  onSearch={storySearch.onSearch}
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
                    if (kind === "persona") {
                      const opt = personaSearch.options.find((o) => o.value === pid);
                      if (opt) remember(pid, opt.label);
                    }
                    setForm({
                      ...form,
                      personaCharacterId: kind === "char" ? pid : null,
                      personaId: kind === "persona" ? pid : null,
                    });
                  }}
                  options={[
                    // the authored cast is small and always fully listed; personas search server-side
                    ...storyCast.map((c) => ({ value: `char:${c.id}`, label: c.name })),
                    ...personaSearch.options.map((o) => ({ value: `persona:${o.value}`, label: o.label })),
                  ]}
                  loading={personaSearch.loading}
                  hasMore={personaSearch.hasMore}
                  isFetchingMore={personaSearch.isFetchingMore}
                  onLoadMore={personaSearch.onLoadMore}
                  onSearch={personaSearch.onSearch}
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
                value={settingValue}
                onChange={(v) => {
                  const [kind, id] = (v as string).split(":");
                  const opt = settingOptions.find((o) => o.value === v);
                  if (opt) remember(id, opt.label);
                  setForm({ ...form, sceneId: kind === "scene" ? id : null, locationId: kind === "location" ? id : null });
                }}
                options={settingOptions}
                loading={sceneSearch.loading || locSearch.loading}
                hasMore={sceneSearch.hasMore || locSearch.hasMore}
                isFetchingMore={sceneSearch.isFetchingMore || locSearch.isFetchingMore}
                onLoadMore={() => {
                  if (sceneSearch.hasMore) sceneSearch.onLoadMore();
                  if (locSearch.hasMore) locSearch.onLoadMore();
                }}
                onSearch={(q) => {
                  sceneSearch.onSearch(q);
                  locSearch.onSearch(q);
                }}
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
                onChange={(v) => {
                  if (v) {
                    const opt = personaSearch.options.find((o) => o.value === v);
                    if (opt) remember(v, opt.label);
                  }
                  setForm({ ...form, personaId: v });
                }}
                options={personaSearch.options}
                loading={personaSearch.loading}
                hasMore={personaSearch.hasMore}
                isFetchingMore={personaSearch.isFetchingMore}
                onLoadMore={personaSearch.onLoadMore}
                onSearch={personaSearch.onSearch}
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
              <MultiCombobox
                className="w-full"
                placeholder="+ attach lorebooks…"
                value={form.lorebookIds}
                options={loreOptions}
                loading={loreSearch.loading}
                hasMore={loreSearch.hasMore}
                isFetchingMore={loreSearch.isFetchingMore}
                onLoadMore={loreSearch.onLoadMore}
                onSearch={loreSearch.onSearch}
                onChange={(vals) => {
                  for (const v of vals) {
                    const opt = loreOptions.find((o) => o.value === v);
                    if (opt) remember(v, opt.label);
                  }
                  setForm({ ...form, lorebookIds: vals });
                }}
              />
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
              void invalidate("/api/chats", "/api/chats/folders");
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
  const [wizard, setWizard] = useState(false);
  const [q, setQ] = useState("");
  const [folder, setFolder] = useState<string>("");
  const importRef = useRef<HTMLInputElement>(null);
  const invalidate = useInvalidate();

  // search & folder filter are server-side (title, tags, character/persona/story names)
  const needle = useDebouncedValue(q.trim());
  const list = usePagedList<any>("/api/chats", {
    q: needle || undefined,
    folder: folder || undefined,
  });
  const visible = list.items;
  const filtered = !!(needle || folder);
  const { data: folderData } = useGet<{ folders: string[] }>("/api/chats/folders");
  const folders = folderData?.folders ?? [];
  const refresh = () => invalidate("/api/chats", "/api/chats/folders");

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
            void refresh();
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

        <div className="space-y-2">
          {!list.isLoading && visible.length === 0 && !filtered && (
            <EmptyState>
              Welcome to AnimaChat ✦ Set up a provider in Settings, create a character in the
              Library, then start your first chat.
            </EmptyState>
          )}
          {!list.isLoading && visible.length === 0 && filtered && <EmptyState>No matches.</EmptyState>}
          {visible.map((c) => (
            <div
              key={c.id}
              className="panel p-3 cursor-pointer hover:border-primary-500 transition-colors group flex items-center gap-3"
              onClick={() => router.push(`/chat/${c.id}`)}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-medium truncate">{c.title}</span>
                  {c.ended && (
                    <Badge size="sm" rounded className="shrink-0">
                      The End
                    </Badge>
                  )}
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-xs min-w-0">
                  <span className="shrink-0 size-6 rounded-full bg-base-300 flex items-center justify-center text-content-300">
                    {MODE_ICONS[c.mode] ?? null}
                  </span>
                  <span className="min-w-0 truncate flex items-center gap-1 text-content-300">
                    {c.characterNames.join(", ")}
                    {c.narratorEnabled && <ScrollText size={11} className="shrink-0" />}
                  </span>
                  {c.tags?.map((t: string) => (
                    <Badge key={t} variant="secondary" size="sm" rounded className="shrink-0">
                      {t}
                    </Badge>
                  ))}
                  {c.mode === "story" && c.storyName && (
                    <Badge variant="secondary" size="sm" rounded className="shrink-0">
                      {c.storyName}
                    </Badge>
                  )}
                </div>
                {c.lastMessage && (
                  <div className="mt-0.5 text-xs text-content-400 truncate">{c.lastMessage}</div>
                )}
              </div>
              <div className="relative shrink-0 self-stretch min-w-16">
                <div className="h-full flex flex-col items-end justify-center transition-opacity group-hover:opacity-0">
                  <span className="text-xs text-content-300">{fmtWhen(c.updatedAt)}</span>
                  <span className="text-tiny text-content-400">{c.messageCount} msgs</span>
                </div>
                <div className="absolute inset-0 flex items-center justify-end gap-1 opacity-0 pointer-events-none transition-opacity group-hover:opacity-100 group-hover:pointer-events-auto">
                  <Button
                    variant="ghost"
                    size="sm"
                    shape="square"
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
                    title="Delete chat"
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (await confirmDialog({ title: "Delete chat", message: `Delete chat "${c.title}"?`, confirmLabel: "Delete", danger: true })) {
                        await api.del(`/api/chats/${c.id}`);
                        refresh();
                      }
                    }}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
            </div>
          ))}
          <LoadMoreSentinel
            hasMore={!!list.hasNextPage}
            isFetching={list.isFetchingNextPage}
            onLoadMore={() => void list.fetchNextPage()}
          />
        </div>
      </div>
      <NewChatWizard open={wizard} onClose={() => setWizard(false)} />
    </div>
  );
}
