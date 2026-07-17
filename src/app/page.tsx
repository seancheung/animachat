"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BookOpen,
  Captions,
  ChevronLeft,
  ChevronRight,
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
    hint: "pure chat — text the characters like real people online, no roleplay conventions",
  },
  {
    key: "immersive",
    label: "Immersive",
    icon: <MapPin size={14} />,
    hint: "roleplay on the VN stage — optional scene or location, narrator, POV",
  },
];
// playthroughs are started from the Stories page — the wizard offers casual/immersive only

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
    sceneId: null,
    locationId: null,
    lorebookIds: [],
    narratorEnabled: false,
    playAsNarrator: false,
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
  // small pages: the picker is a single row — a page fills it with a little headroom,
  // and the strip's sentinel pulls the next one as the user scrolls sideways
  const charList = usePagedList<any>(
    "/api/characters",
    { q: debouncedCharQ || undefined, limit: 12 },
    { enabled: open }
  );
  const personaSearch = useComboboxSearch("/api/personas", {
    enabled: open,
    selected: form.personaId ? { value: form.personaId, label: labels[form.personaId] ?? "…" } : null,
  });
  const sceneSearch = useComboboxSearch("/api/scenes", {
    enabled: open && form.mode === "immersive",
    toOption: (s: any) => ({ value: `scene:${s.id}`, label: s.name }),
  });
  const locSearch = useComboboxSearch("/api/locations", {
    enabled: open && form.mode === "immersive",
    toOption: (l: any) => ({ value: `location:${l.id}`, label: l.name }),
  });
  const loreSearch = useComboboxSearch("/api/lorebooks", { enabled: open });

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

  // the picker is one horizontally-scrolled row; the chevrons page it by a viewport
  // width and light up only in the direction that actually has content
  const stripRef = useRef<HTMLDivElement>(null);
  const [strip, setStrip] = useState({ left: false, right: false });
  const updateStrip = () => {
    const el = stripRef.current;
    if (!el) return;
    const left = el.scrollLeft > 4;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
    setStrip((p) => (p.left === left && p.right === right ? p : { left, right }));
  };
  useEffect(updateStrip, [gridItems.length]); // re-measure when items land or picks reorder
  const pageStrip = (dir: 1 | -1) =>
    stripRef.current?.scrollBy({ left: dir * stripRef.current.clientWidth, behavior: "smooth" });
  const stripOverflows = strip.left || strip.right || !!charList.hasNextPage;

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

  // casual is pure chat: no narrator (nobody to carry a chat but the characters),
  // no narrator seat, no POV, no setting, no chat layout — the messenger view is the mode
  const pure = form.mode === "casual";
  const playAsNarrator = !pure && form.playAsNarrator;
  const narrator = pure || playAsNarrator ? false : form.narratorEnabled;
  const modeValid = pure ? form.characterIds.length > 0 : form.characterIds.length > 0 || narrator;
  // greetings fit the single-character shapes: a casual 1:1, or an immersive 1:1 without narrator
  const greetingsAvailable =
    form.characterIds.length === 1 && (pure || (!narrator && !playAsNarrator));

  return (
    <Modal open={open} onClose={onClose} title="New chat" wide>
      <div className="space-y-4">
        <Field label="Chat mode">
          <SegmentedControl<ChatMode>
            value={form.mode}
            className="w-full"
            onChange={(v) => setForm({ ...form, mode: v, sceneId: null, locationId: null })}
            items={MODES.map((m) => ({
              value: m.key,
              // the tooltip previews a mode before it's picked; the line below explains the picked one
              label: (
                <Tooltip content={m.hint}>
                  <span className="inline-flex items-center gap-1.5">
                    {m.icon} {m.label}
                  </span>
                </Tooltip>
              ),
            }))}
          />
          <div className="text-xs text-content-400 mt-1">{MODES.find((m) => m.key === form.mode)?.hint}</div>
        </Field>

        <Field
            label={pure || !narrator ? "Characters (required)" : "Characters"}
            hint="pick in speaking order — multiple = group chat with orchestrated turns; [char_name] resolves to #1, [char2_name] to #2… — fixed once the chat is created"
          >
            <Input
              className="w-full mb-2"
              icon={<Search />}
              placeholder="Search characters…"
              value={charQ}
              onChange={setCharQ}
            />
            <div className="flex items-center gap-1.5">
              {stripOverflows && (
                <Button variant="ghost" size="sm" shape="circle" disabled={!strip.left} title="Previous characters" onClick={() => pageStrip(-1)}>
                  <ChevronLeft />
                </Button>
              )}
              <div ref={stripRef} onScroll={updateStrip} className="flex flex-1 min-w-0 gap-2 overflow-x-auto">
                {gridItems.map((c) => {
                  const idx = form.characterIds.indexOf(c.id);
                  return (
                    <button
                      key={c.id}
                      className={cn(
                        "panel w-24 shrink-0 overflow-hidden text-left transition-colors relative cursor-pointer",
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
                  <div className="text-sm text-content-300 py-2">
                    {debouncedCharQ
                      ? `Nothing matches “${debouncedCharQ}”.`
                      : "No characters yet — create one in the Library first."}
                  </div>
                )}
                <LoadMoreSentinel
                  className="w-10 shrink-0 self-center"
                  hasMore={!!charList.hasNextPage}
                  isFetching={charList.isFetchingNextPage}
                  onLoadMore={() => void charList.fetchNextPage()}
                />
              </div>
              {stripOverflows && (
                <Button variant="ghost" size="sm" shape="circle" disabled={!strip.right && !charList.hasNextPage} title="More characters" onClick={() => pageStrip(1)}>
                  <ChevronRight />
                </Button>
              )}
            </div>
          </Field>

        <div className="grid md:grid-cols-3 gap-3">
          {form.mode === "immersive" && (
            <Field label="Setting" hint="optional, fixed for the whole chat — empty keeps the default backdrop">
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
                placeholder="(none)"
                clearable
                onClear={() => setForm({ ...form, sceneId: null, locationId: null })}
              />
            </Field>
          )}
          {!pure && (
            <Field label="Play as narrator" hint="you write the narration; characters respond — replaces the AI narrator and your persona">
              <Switch
                className="h-8"
                value={playAsNarrator}
                onChange={(v) =>
                  setForm({
                    ...form,
                    playAsNarrator: v,
                    ...(v ? { personaId: null, narratorEnabled: false, greetings: false } : {}),
                  })
                }
                label={playAsNarrator ? "You are the narrator" : "Off"}
              />
            </Field>
          )}
          {!playAsNarrator && (
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
          {!pure && (
            <Field label="POV override">
              {playAsNarrator ? (
                <div className="h-8 flex items-center text-sm text-content-300">
                  Third person — narration has no &quot;you&quot;
                </div>
              ) : (
                <Select
                  className="w-full"
                  value={form.pov || null}
                  onChange={(v) => setForm({ ...form, pov: v })}
                  options={Object.entries(POV_LABELS).map(([k, v]) => ({ value: k, label: v }))}
                  placeholder="(global default)"
                  clearable
                  onClear={() => setForm({ ...form, pov: "" })}
                />
              )}
            </Field>
          )}
          {!pure && (
            <Field label="Chat layout" hint="presentation only — switchable anytime in chat settings">
              <ToggleGroup<"panel" | "dialogue">
                value={form.layout}
                onChange={(v) => v && setForm({ ...form, layout: v })}
              >
                <Toggle value="panel"><PanelRight size={13} /> Side panel</Toggle>
                <Toggle value="dialogue"><Captions size={13} /> Dialogue box</Toggle>
              </ToggleGroup>
            </Field>
          )}
          {!pure && (
            <Field
              label="Narrator"
              hint={
                playAsNarrator
                  ? "that's you — the AI narrator is off"
                  : "narration, suggested actions — speaks first"
              }
            >
              {playAsNarrator ? (
                <div className="h-8 flex items-center text-sm text-content-300">
                  <ScrollText size={14} className="mr-1.5" /> You
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
          )}
          {greetingsAvailable && (
            <Field
              label="Greeting"
              hint={pure ? "their greeting opens the chat as their first text" : "the character opens with their greeting message"}
            >
              <Switch
                value={form.greetings}
                onChange={(v) => setForm({ ...form, greetings: v })}
                label={form.greetings ? "Character speaks first" : "You speak first"}
                className="h-8"
              />
            </Field>
          )}
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
        </div>
        <Button
          disabled={busy || !modeValid}
          onClick={async () => {
            setBusy(true);
            try {
              const chat = await api.post("/api/chats", {
                ...form,
                narratorEnabled: narrator,
                playAsNarrator,
                // casual has no POV (pure chat); narrator-play pins third person (narration has no "you")
                pov: pure ? "" : playAsNarrator ? "third" : form.pov,
                greetings: greetingsAvailable && form.greetings,
                // the messenger view has no chat layouts — the layout pick is stage-only
                overrides: !pure && form.layout === "dialogue" ? { layout: "dialogue" } : {},
              });
              void invalidate("/api/chats", "/api/chats/folders");
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
  const [wizard, setWizard] = useState(false);
  const [q, setQ] = useState("");
  const [folder, setFolder] = useState<string>("");
  const importRef = useRef<HTMLInputElement>(null);
  const invalidate = useInvalidate();

  // search & folder filter are server-side (title, tags, character/persona names);
  // playthroughs live on the Stories page — this list is casual/immersive only
  const needle = useDebouncedValue(q.trim());
  const list = usePagedList<any>("/api/chats", {
    q: needle || undefined,
    folder: folder || undefined,
    kind: "chats",
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
                    {(c.personaName || c.playAsNarrator) && (
                      <span className="text-content-400">
                        · as {c.playAsNarrator ? "Narrator" : c.personaName}
                      </span>
                    )}
                  </span>
                  {c.tags?.map((t: string) => (
                    <Badge key={t} variant="secondary" size="sm" rounded className="shrink-0">
                      {t}
                    </Badge>
                  ))}
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
