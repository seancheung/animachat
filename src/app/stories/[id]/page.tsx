"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BookMarked,
  Play,
  Plus,
  Trash2,
} from "lucide-react";
import { AssistPanel } from "@/components/AssistPanel";
import { PlayStoryDialog } from "@/components/PlayStoryDialog";
import { CharacterFields } from "@/components/editors/CharacterEditor";
import { LocationFields, LorebookFields, SceneFields, TagsField } from "@/components/editors/SimpleEditors";
import { Field } from "@/components/app";
import { confirmDialog } from "@/components/confirm";
import Badge from "@/components/ui/badge";
import Button from "@/components/ui/button";
import Checkbox from "@/components/ui/checkbox";
import Collapsible from "@/components/ui/collapsible";
import Combobox from "@/components/ui/combobox";
import Input from "@/components/ui/input";
import SegmentedControl from "@/components/ui/segmented-control";
import Textarea from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { allowedNextScenes } from "@/lib/stage";
import { literalizeStoryTags, mergeStoryAssist } from "@/lib/storyAssist";
import { emptyStoryDoc, normalizeCharacter, normalizeLocation, normalizeLorebook, normalizeScene } from "@/lib/storyDoc";
import { useComboboxSearch, useGet, useInvalidate } from "@/lib/queries";
import { api, uid } from "@/lib/ui";
import type { StoryScene, StorySecret } from "@/lib/types";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Expandable row for an embedded item — summary line with actions, sheet below. */
function ItemRow({
  title,
  badge,
  actions,
  children,
}: {
  title: string;
  badge?: string;
  actions: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Collapsible
      bordered
      title={
        <>
          <span className="flex-1 truncate">{title || "(unnamed)"}</span>
          {badge && (
            <Badge variant="secondary" size="sm" rounded className="shrink-0">
              {badge}
            </Badge>
          )}
        </>
      }
      chevron={() => <span className="flex shrink-0 items-center gap-1 pr-3">{actions}</span>}
    >
      <div className="space-y-3">{children}</div>
    </Collapsible>
  );
}

function MoveButtons({ onMove }: { onMove: (d: number) => void }) {
  return (
    <>
      <Button variant="ghost" size="sm" shape="square" title="Move up" onClick={() => onMove(-1)}><ArrowUp /></Button>
      <Button variant="ghost" size="sm" shape="square" title="Move down" onClick={() => onMove(1)}><ArrowDown /></Button>
    </>
  );
}

/**
 * Full-page story editor. A story is a self-contained document — its characters,
 * scenes, locations and lorebooks are embedded copies edited right here, with the
 * whole-document AI co-writer docked on the right. `/stories/new` starts a blank
 * draft; nothing persists until Save.
 */
export default function StoryEditorPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const invalidate = useInvalidate();
  const isNew = params.id === "new";
  const { data } = useGet<any>(`/api/stories/${params.id}`, { enabled: !isNew });
  const [form, setForm] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [playOpen, setPlayOpen] = useState(false);
  // section tabs — presentation only: the whole draft lives in the one `form`
  // state, so switching tabs never drops unsaved edits
  const [tab, setTab] = useState<"story" | "cast" | "locations" | "scenes" | "secrets" | "lorebooks">("story");
  // seed the draft during render (guarded — React re-renders immediately), the
  // pattern the chat page uses; an effect would flash an empty frame first
  if (form === null) {
    if (isNew) setForm({ ...emptyStoryDoc(), tags: [] });
    else if (data) setForm(data);
  }

  const charSearch = useComboboxSearch("/api/characters");
  const sceneSearch = useComboboxSearch("/api/scenes");
  const locSearch = useComboboxSearch("/api/locations");
  const loreSearch = useComboboxSearch("/api/lorebooks");

  if (!form) return null;

  const chars: any[] = form.characters ?? [];
  const scenes: StoryScene[] = form.scenes ?? [];
  const locations: any[] = form.locations ?? [];
  const lorebooks: any[] = form.lorebooks ?? [];
  const secrets: StorySecret[] = form.secrets ?? [];
  const charName = (cid: string) => chars.find((c) => c.id === cid)?.name ?? "?";

  const patch = (p: any) => setForm({ ...form, ...p });
  // add-from-library goes through the literalizer: library sheets legitimately
  // carry placeholder tags, story content never does (it's all fixed names)
  const patchLiteralized = (p: any) => setForm((f: any) => ({ ...f, ...literalizeStoryTags({ ...f, ...p }) }));
  const setAt = (key: string, i: number) => (next: any) =>
    setForm((f: any) => ({ ...f, [key]: f[key].map((x: any, k: number) => (k === i ? next : x)) }));
  const moveAt = (key: string, i: number, d: number) => {
    const list = [...form[key]];
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    patch({ [key]: list });
  };

  async function save() {
    setSaving(true);
    try {
      // the server normalizes & self-heals the document — refresh the draft from it
      const saved = form.id
        ? await api.put(`/api/stories/${form.id}`, form)
        : await api.post("/api/stories", form);
      setForm(saved);
      if (!form.id) router.replace(`/stories/${saved.id}`);
      void invalidate("/api/stories", "/api/library/tags", "/api/library/search");
      toast.success("Story saved");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  /* ---- cast ---- */
  const removeChar = async (c: any) => {
    if (!(await confirmDialog({ title: "Remove cast member", message: `Remove "${c.name}" from this story? They also leave every scene cast and secret.`, confirmLabel: "Remove", danger: true }))) return;
    patch({
      characters: chars.filter((x) => x.id !== c.id),
      scenes: scenes.map((s) => ({ ...s, cast: s.cast.filter((x) => x !== c.id) })),
      secrets: secrets.map((s) => ({ ...s, knownBy: s.knownBy.filter((x) => x !== c.id) })),
    });
  };
  const addCharFromLibrary = async (id: string) => {
    try {
      const full = await api.get(`/api/characters/${id}`);
      // a copy with a fresh internal id — embedded items never share ids with library rows
      patchLiteralized({ characters: [...chars, { ...full, id: uid() }] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };
  const copyCharToLibrary = async (c: any) => {
    if (!(await confirmDialog({ title: "Copy to library", message: `Copy "${c.name}" to the library as a new character? A snapshot — later edits on either side don't carry over.`, confirmLabel: "Copy" }))) return;
    try {
      await api.post("/api/characters", { ...c, id: undefined, tags: [] });
      void invalidate("/api/characters", "/api/library/search");
      toast.success(`Character "${c.name}" copied to the library`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  /* ---- locations ---- */
  const removeLocation = async (l: any) => {
    if (!(await confirmDialog({ title: "Remove location", message: `Remove "${l.name}" from this story? Scenes set there lose the link.`, confirmLabel: "Remove", danger: true }))) return;
    patch({
      locations: locations.filter((x) => x.id !== l.id),
      scenes: scenes.map((s) => (s.locationId === l.id ? { ...s, locationId: null } : s)),
    });
  };
  const addLocationFromLibrary = async (id: string) => {
    try {
      const full = await api.get(`/api/locations/${id}`);
      patchLiteralized({ locations: [...locations, { ...full, id: uid() }] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };
  const copyLocationToLibrary = async (l: any) => {
    if (!(await confirmDialog({ title: "Copy to library", message: `Copy "${l.name}" to the library as a new location?`, confirmLabel: "Copy" }))) return;
    try {
      await api.post("/api/locations", { ...l, id: undefined, tags: [] });
      void invalidate("/api/locations", "/api/library/search");
      toast.success(`Location "${l.name}" copied to the library`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  /* ---- scenes ---- */
  const newStoryScene = (scene: any): StoryScene => ({
    ...scene,
    // a new scene opens with the whole roster on stage — prune per scene
    cast: chars.map((c) => c.id),
    goal: "",
    obstacles: "",
    exit: "",
    pressures: "",
    successors: [],
  });
  const removeScene = async (s: StoryScene) => {
    if (!(await confirmDialog({ title: "Remove scene", message: `Remove "${s.name}" from this story?`, confirmLabel: "Remove", danger: true }))) return;
    patch({
      scenes: scenes
        .filter((x) => x.id !== s.id)
        // a removed scene also stops being anyone's branch target
        .map((x) => ({ ...x, successors: (x.successors ?? []).filter((r) => r.sceneId !== s.id) })),
    });
  };
  const addSceneFromLibrary = async (id: string) => {
    try {
      const full = await api.get(`/api/scenes/${id}`);
      // the scene's library location rides along as an embedded copy
      let locationId: string | null = null;
      if (full.locationId) {
        try {
          const loc = await api.get(`/api/locations/${full.locationId}`);
          locationId = uid();
          patchLiteralized({
            locations: [...locations, { ...loc, id: locationId }],
            scenes: [...scenes, newStoryScene({ ...full, id: uid(), locationId })],
          });
          return;
        } catch {
          /* location gone — embed the scene alone */
        }
      }
      patchLiteralized({ scenes: [...scenes, newStoryScene({ ...full, id: uid(), locationId })] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };
  const copySceneToLibrary = async (s: StoryScene) => {
    if (!(await confirmDialog({ title: "Copy to library", message: `Copy "${s.name}" to the library as a new scene?${s.locationId ? " Its location is copied with it." : ""}`, confirmLabel: "Copy" }))) return;
    try {
      let locationId: string | null = null;
      const loc = locations.find((l) => l.id === s.locationId);
      if (loc) locationId = (await api.post("/api/locations", { ...loc, id: undefined, tags: [] })).id;
      // the story-specific layer (cast, contract, successors) stays behind
      const sheet: any = { ...s, id: undefined, locationId, tags: [] };
      for (const k of ["cast", "goal", "obstacles", "exit", "pressures", "successors"]) delete sheet[k];
      await api.post("/api/scenes", sheet);
      void invalidate("/api/scenes", "/api/locations", "/api/library/search");
      toast.success(`Scene "${s.name}" copied to the library`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };
  const locationOptions = locations.map((l) => ({ value: l.id, label: l.name }));
  // where each scene can lead, under the same rule the narrator plays by — a scene
  // with no road out is an ending (several endings = several ways the story closes)
  const sceneRefs = scenes.map((e) => ({ id: e.id, cast: e.cast, successors: e.successors }));
  const isEnding = (sceneId: string) => allowedNextScenes(sceneRefs, sceneId).length === 0;

  /* ---- lorebooks ---- */
  const removeLorebook = async (lb: any) => {
    if (!(await confirmDialog({ title: "Remove lorebook", message: `Remove "${lb.name}" from this story?`, confirmLabel: "Remove", danger: true }))) return;
    patch({ lorebooks: lorebooks.filter((x) => x.id !== lb.id) });
  };
  const addLorebookFromLibrary = async (id: string) => {
    try {
      const full = await api.get(`/api/lorebooks/${id}`);
      patchLiteralized({ lorebooks: [...lorebooks, { ...full, id: uid() }] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };
  const copyLorebookToLibrary = async (lb: any) => {
    if (!(await confirmDialog({ title: "Copy to library", message: `Copy "${lb.name}" to the library as a new lorebook?`, confirmLabel: "Copy" }))) return;
    try {
      await api.post("/api/lorebooks", { ...lb, id: undefined, tags: [] });
      void invalidate("/api/lorebooks", "/api/library/search");
      toast.success(`Lorebook "${lb.name}" copied to the library`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const setSecret = (i: number, p: Partial<StorySecret>) => {
    const next = [...secrets];
    next[i] = { ...next[i], ...p };
    patch({ secrets: next });
  };

  const copyButton = (onClick: () => void) => (
    <Button variant="ghost" size="sm" shape="square" title="Copy to the library (a snapshot — edits don't carry over)" onClick={onClick}>
      <BookMarked />
    </Button>
  );

  return (
    <div className="h-full overflow-hidden">
      <div className="max-w-6xl mx-auto h-full p-6 grid grid-cols-[1fr_340px] grid-rows-[auto_minmax(0,1fr)] gap-x-6 gap-y-4">
        <div className="col-span-2 flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => router.push("/stories")}>
            <ArrowLeft /> Stories
          </Button>
          <span className="font-medium truncate flex-1">
            {form.name || (isNew ? "New story" : "Untitled story")}
          </span>
          {form.id && (
            <Button variant="secondary" onClick={() => setPlayOpen(true)}>
              <Play /> Play
            </Button>
          )}
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>

        <div className="min-h-0 flex flex-col gap-3">
          <SegmentedControl
            variant="secondary"
            size="sm"
            className="w-full"
            value={tab}
            onChange={setTab}
            items={[
              { value: "story", label: "Story" },
              { value: "cast", label: `Cast${chars.length ? ` (${chars.length})` : ""}` },
              { value: "locations", label: `Locations${locations.length ? ` (${locations.length})` : ""}` },
              { value: "scenes", label: `Scenes${scenes.length ? ` (${scenes.length})` : ""}` },
              { value: "secrets", label: `Secrets${secrets.length ? ` (${secrets.length})` : ""}` },
              { value: "lorebooks", label: `Lorebooks${lorebooks.length ? ` (${lorebooks.length})` : ""}` },
            ]}
          />
          <div className="flex-1 min-h-0 space-y-3 overflow-y-auto pr-1">
          {tab === "story" && (
            <>
          <Field label="Name">
            <Input className="w-full" value={form.name ?? ""} onChange={(v) => patch({ name: v })} />
          </Field>
          <Field label="Premise" hint="the situation as play opens — spoiler-free (everyone sees it); author truths and pressures, not an event script; write literal names — story content doesn't use placeholder tags">
            <Textarea className="w-full h-28" value={form.description ?? ""} onChange={(v) => patch({ description: v })} />
          </Field>
          <Field label="Destination" hint="one line naming where the story is headed and what 'the end' means — narrator & director only; empty = ending left to the table">
            <Input className="w-full" value={form.destination ?? ""} onChange={(v) => patch({ destination: v })} />
          </Field>
          <TagsField value={form.tags} onChange={(tags) => patch({ tags })} />
            </>
          )}

          {tab === "cast" && (
            <>
          <div className="text-xs text-content-400">
            the story&apos;s own characters in roster order — embedded copies, invisible to the
            library; a playthrough can play as any of them
          </div>
          <div className="space-y-1.5">
            {chars.map((c, i) => (
              <ItemRow
                key={c.id}
                title={`${i + 1}. ${c.name}`}
                actions={
                  <>
                    <MoveButtons onMove={(d) => moveAt("characters", i, d)} />
                    {copyButton(() => copyCharToLibrary(c))}
                    <Button variant="ghost" size="sm" shape="square" title="Remove from the story" onClick={() => removeChar(c)}><Trash2 /></Button>
                  </>
                }
              >
                <CharacterFields form={c} setForm={setAt("characters", i)} embedded />
              </ItemRow>
            ))}
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => patch({ characters: [...chars, normalizeCharacter({ name: "" })] })}>
                <Plus /> New character
              </Button>
              <Combobox
                className="flex-1"
                value={null}
                onChange={(v) => v && addCharFromLibrary(v)}
                options={charSearch.options}
                loading={charSearch.loading}
                hasMore={charSearch.hasMore}
                isFetchingMore={charSearch.isFetchingMore}
                onLoadMore={charSearch.onLoadMore}
                onSearch={charSearch.onSearch}
                placeholder="+ copy from library…"
              />
            </div>
          </div>

            </>
          )}

          {tab === "locations" && (
            <>
          <div className="text-xs text-content-400">embedded places — scenes (next tab) can be set in them</div>
          <div className="space-y-1.5">
            {locations.map((l, i) => (
              <ItemRow
                key={l.id}
                title={l.name}
                actions={
                  <>
                    {copyButton(() => copyLocationToLibrary(l))}
                    <Button variant="ghost" size="sm" shape="square" title="Remove from the story" onClick={() => removeLocation(l)}><Trash2 /></Button>
                  </>
                }
              >
                <LocationFields form={l} setForm={setAt("locations", i)} embedded />
              </ItemRow>
            ))}
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => patch({ locations: [...locations, normalizeLocation({ name: "" })] })}>
                <Plus /> New location
              </Button>
              <Combobox
                className="flex-1"
                value={null}
                onChange={(v) => v && addLocationFromLibrary(v)}
                options={locSearch.options}
                loading={locSearch.loading}
                hasMore={locSearch.hasMore}
                isFetchingMore={locSearch.isFetchingMore}
                onLoadMore={locSearch.onLoadMore}
                onSearch={locSearch.onSearch}
                placeholder="+ copy from library…"
              />
            </div>
          </div>

            </>
          )}

          {tab === "scenes" && (
            <>
          <div className="text-xs text-content-400">
            each scene lists who is on stage when it opens; the narrator can bring others in mid-scene.
            without branches a story plays in order; a scene named as a branch target is reached only
            by that road, and a scene with no road out is an ending
          </div>
          <div className="space-y-1.5">
            {scenes.map((entry, i) => (
              <ItemRow
                key={entry.id}
                title={`${i + 1}. ${entry.name}`}
                badge={isEnding(entry.id) ? "an ending" : undefined}
                actions={
                  <>
                    <MoveButtons onMove={(d) => moveAt("scenes", i, d)} />
                    {copyButton(() => copySceneToLibrary(entry))}
                    <Button variant="ghost" size="sm" shape="square" title="Remove from the story" onClick={() => removeScene(entry)}><Trash2 /></Button>
                  </>
                }
              >
                <SceneFields
                  form={entry}
                  setForm={setAt("scenes", i)}
                  embedded
                  locationField={
                    <Field label="Location" hint="one of the story's locations — its artwork/BGM take precedence in chat">
                      <Combobox
                        className="w-full"
                        value={entry.locationId ?? null}
                        onChange={(v) => setAt("scenes", i)({ ...entry, locationId: v })}
                        options={locationOptions}
                        placeholder="(none)"
                        clearable
                        onClear={() => setAt("scenes", i)({ ...entry, locationId: null })}
                      />
                    </Field>
                  }
                />
                {chars.length > 0 && (
                  <Field label="On stage when the scene opens">
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      {chars.map((c) => (
                        <Checkbox
                          key={c.id}
                          value={entry.cast.includes(c.id)}
                          onChange={(v) =>
                            setAt("scenes", i)({
                              ...entry,
                              cast: v ? [...entry.cast, c.id] : entry.cast.filter((x) => x !== c.id),
                            })
                          }
                          label={c.name}
                        />
                      ))}
                    </div>
                  </Field>
                )}
                {/* the scene contract — narrator/director-only dramaturgy; all optional */}
                <Field label="Scene contract" hint="narrator & director only — a job, not a script">
                  <div className="space-y-1">
                    <Input className="w-full" placeholder="goal — what this scene is for…" value={entry.goal ?? ""} onChange={(v) => setAt("scenes", i)({ ...entry, goal: v })} />
                    <Input className="w-full" placeholder="obstacles — what stands in the way…" value={entry.obstacles ?? ""} onChange={(v) => setAt("scenes", i)({ ...entry, obstacles: v })} />
                    <Input className="w-full" placeholder="advance when — the narrator's cue to move on…" value={entry.exit ?? ""} onChange={(v) => setAt("scenes", i)({ ...entry, exit: v })} />
                    <Input className="w-full" placeholder="meanwhile, elsewhere — offstage pressure that keeps moving…" value={entry.pressures ?? ""} onChange={(v) => setAt("scenes", i)({ ...entry, pressures: v })} />
                  </div>
                </Field>
                {/* authored branching — allowed successors; none = the next scene in order */}
                <Field label="Branches" hint="allowed next scenes — none = the next in order">
                  <div className="space-y-1">
                    {(entry.successors ?? []).map((suc, k) => (
                      <div key={`${suc.sceneId}-${k}`} className="flex items-center gap-2">
                        <span className="text-content-300 shrink-0 text-sm">
                          → {scenes.find((s) => s.id === suc.sceneId)?.name ?? "?"}
                        </span>
                        <Input
                          className="flex-1 min-w-0"
                          placeholder="this road when… (condition hint, optional)"
                          value={suc.hint}
                          onChange={(v) =>
                            setAt("scenes", i)({
                              ...entry,
                              successors: (entry.successors ?? []).map((x, m) => (m === k ? { ...x, hint: v } : x)),
                            })
                          }
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          shape="square"
                          onClick={() =>
                            setAt("scenes", i)({ ...entry, successors: (entry.successors ?? []).filter((_, m) => m !== k) })
                          }
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    ))}
                    <Combobox
                      className="w-full"
                      value={null}
                      onChange={(v) =>
                        v && setAt("scenes", i)({ ...entry, successors: [...(entry.successors ?? []), { sceneId: v, hint: "" }] })
                      }
                      options={scenes
                        .filter((e) => e.id !== entry.id && !(entry.successors ?? []).some((x) => x.sceneId === e.id))
                        .map((e) => ({ value: e.id, label: e.name }))}
                      placeholder={
                        entry.successors?.length
                          ? "+ add another road…"
                          : "+ branch to… (none = the next scene in order)"
                      }
                    />
                  </div>
                </Field>
              </ItemRow>
            ))}
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => patch({ scenes: [...scenes, newStoryScene(normalizeScene({ name: "" }))] })}
              >
                <Plus /> New scene
              </Button>
              <Combobox
                className="flex-1"
                value={null}
                onChange={(v) => v && addSceneFromLibrary(v)}
                options={sceneSearch.options}
                loading={sceneSearch.loading}
                hasMore={sceneSearch.hasMore}
                isFetchingMore={sceneSearch.isFetchingMore}
                onLoadMore={sceneSearch.onLoadMore}
                onSearch={sceneSearch.onSearch}
                placeholder="+ copy from library… (brings its location along)"
              />
            </div>
          </div>

            </>
          )}

          {tab === "secrets" && (
            <>
          <div className="text-xs text-content-400">
            the story&apos;s hidden truths, written in present tense (already true as play opens) — holders guard them,
            everyone else can&apos;t see them, the narrator reveals them when the fiction earns it. &quot;known by&quot; =
            already knows at the story&apos;s open, never &quot;it concerns them&quot; — someone meant to learn it mid-story
            starts unchecked
          </div>
          <div className="space-y-2">
            {secrets.map((s, i) => (
              <div key={s.id} className="bg-base-200 rounded-md px-3 py-2 text-sm space-y-1.5">
                <div className="flex items-center gap-2">
                  <Input className="flex-1" placeholder="title — the secret's short handle…" value={s.title} onChange={(v) => setSecret(i, { title: v })} />
                  <Button variant="ghost" size="sm" shape="square" onClick={() => patch({ secrets: secrets.filter((_, k) => k !== i) })}><Trash2 /></Button>
                </div>
                <Textarea className="w-full h-16" placeholder="the truth itself — present tense, already true as play opens…" value={s.content} onChange={(v) => setSecret(i, { content: v })} />
                {chars.length > 0 && (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    <span className="text-xs text-content-400">knows from the start:</span>
                    {chars.map((c) => (
                      <Checkbox
                        key={c.id}
                        value={s.knownBy.includes(c.id)}
                        onChange={(v) =>
                          setSecret(i, { knownBy: v ? [...s.knownBy, c.id] : s.knownBy.filter((x) => x !== c.id) })
                        }
                        label={charName(c.id)}
                      />
                    ))}
                  </div>
                )}
                <Input className="w-full" placeholder="wants to surface when… (reveal hint, optional)" value={s.revealHint} onChange={(v) => setSecret(i, { revealHint: v })} />
              </div>
            ))}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => patch({ secrets: [...secrets, { id: uid(), title: "", content: "", knownBy: [], revealHint: "" }] })}
            >
              <Plus /> Add secret
            </Button>
          </div>

            </>
          )}

          {tab === "lorebooks" && (
            <>
          <div className="text-xs text-content-400">embedded world knowledge — attached to every playthrough</div>
          <div className="space-y-1.5">
            {lorebooks.map((lb, i) => (
              <ItemRow
                key={lb.id}
                title={lb.name}
                actions={
                  <>
                    {copyButton(() => copyLorebookToLibrary(lb))}
                    <Button variant="ghost" size="sm" shape="square" title="Remove from the story" onClick={() => removeLorebook(lb)}><Trash2 /></Button>
                  </>
                }
              >
                <LorebookFields form={lb} setForm={setAt("lorebooks", i)} embedded />
              </ItemRow>
            ))}
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => patch({ lorebooks: [...lorebooks, normalizeLorebook({ name: "" })] })}>
                <Plus /> New lorebook
              </Button>
              <Combobox
                className="flex-1"
                value={null}
                onChange={(v) => v && addLorebookFromLibrary(v)}
                options={loreSearch.options}
                loading={loreSearch.loading}
                hasMore={loreSearch.hasMore}
                isFetchingMore={loreSearch.isFetchingMore}
                onLoadMore={loreSearch.onLoadMore}
                onSearch={loreSearch.onSearch}
                placeholder="+ copy from library…"
              />
            </div>
          </div>

            </>
          )}
          </div>
        </div>

        <AssistPanel
          entityType="story"
          fields={form}
          onFields={(partial) => setForm((f: any) => (f ? mergeStoryAssist(f, partial) : f))}
          onRestore={setForm}
          allowFiles
          emptyHint='Describe the story you want and we&apos;ll build the whole thing — premise, cast, places, scenes, secrets. Attach a .txt/.md file (file button) to extract a story from a novel or notes, or attach library items with the paperclip to base embedded copies on them.'
        />
      </div>
      {form.id && <PlayStoryDialog storyId={form.id} open={playOpen} onClose={() => setPlayOpen(false)} />}
    </div>
  );
}
