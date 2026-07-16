"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { AssistPanel } from "@/components/AssistPanel";
import { AssetInput } from "@/components/AssetInput";
import { Field } from "@/components/app";
import Button from "@/components/ui/button";
import Checkbox from "@/components/ui/checkbox";
import Collapsible from "@/components/ui/collapsible";
import Combobox from "@/components/ui/combobox";
import Input from "@/components/ui/input";
import InputNumber from "@/components/ui/input-number";
import Textarea from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import Tooltip from "@/components/ui/tooltip";
import { useComboboxSearch, useEntityName } from "@/lib/queries";
import { api, uid } from "@/lib/ui";
import { cn } from "@/utils/cn";
import type { Location, Lorebook, LorebookEntry, Persona, Scene } from "@/lib/types";

/* eslint-disable @typescript-eslint/no-explicit-any */

export function EditorShell({
  entityType,
  form,
  setForm,
  onSave,
  saving,
  children,
  assist = true,
  mapAssistFields,
}: {
  entityType: string;
  form: any;
  setForm: (f: any) => void;
  onSave: () => void;
  saving: boolean;
  children: React.ReactNode;
  assist?: boolean;
  /** translate AI-written fields (e.g. name-based links) into form shape before merging;
   *  may be async (name links resolve against the server) */
  mapAssistFields?: (partial: any) => any | Promise<any>;
}) {
  return (
    // the explicit minmax(0,1fr) row pins both columns to the 70vh box — an implicit auto
    // row would grow to the form's full height, pushing content (unscrollably) past the
    // dialog and letting focus-scroll drag the whole overlay around
    <div className={assist ? "grid grid-cols-[1fr_320px] grid-rows-[minmax(0,1fr)] gap-4 h-[70vh]" : ""}>
      <div className="space-y-3 overflow-y-auto pr-1 min-h-0">
        {children}
        <div className="pt-2">
          <Button onClick={onSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
      {assist && (
        <AssistPanel
          entityType={entityType}
          fields={form}
          onFields={async (partial) => {
            const mapped = mapAssistFields ? await mapAssistFields(partial) : partial;
            // functional update: async mapping must not clobber fields edited meanwhile
            setForm((f: any) => ({ ...f, ...mapped }));
          }}
          onRestore={setForm}
        />
      )}
    </div>
  );
}

export function useEditor<T extends { id?: string }>(
  initial: T,
  endpoint: string,
  onSaved: () => void
) {
  const [form, setForm] = useState<any>(initial);
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    try {
      if (form.id) await api.put(`${endpoint}/${form.id}`, form);
      else await api.post(endpoint, form);
      onSaved();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }
  return { form, setForm, save, saving };
}

const parseTags = (s: string) => s.split(",").map((t) => t.trim()).filter(Boolean);

/** Library tags, edited as comma-separated text (same convention as the chat drawer). */
export function TagsField({ value, onChange }: { value: string[] | undefined; onChange: (tags: string[]) => void }) {
  const joined = (value ?? []).join(", ");
  const [text, setText] = useState(joined);
  // external form replacement (assist rewind/restore) refreshes the input;
  // the user's own keystrokes already match and are left alone
  useEffect(() => {
    setText((cur) => (parseTags(cur).join(", ") === joined ? cur : joined));
  }, [joined]);
  return (
    <Field label="Tags" hint="comma-separated — for grouping & filtering">
      <Input
        className="w-full"
        placeholder="e.g. fantasy, main-cast"
        value={text}
        onChange={(v) => {
          setText(v);
          onChange(parseTags(v));
        }}
      />
    </Field>
  );
}

export function PersonaEditor({ initial, onSaved }: { initial: Partial<Persona>; onSaved: () => void }) {
  const { form, setForm, save, saving } = useEditor(initial, "/api/personas", onSaved);
  return (
    <EditorShell entityType="persona" form={form} setForm={setForm} onSave={save} saving={saving}>
      <Field label="Name">
        <Input className="w-full" value={form.name ?? ""} onChange={(v) => setForm({ ...form, name: v })} />
      </Field>
      <Field label="Description" hint="who you are in the roleplay — characters see this; placeholders like [char_name] work here">
        <Textarea className="w-full h-40" value={form.description ?? ""} onChange={(v) => setForm({ ...form, description: v })} />
      </Field>
      <TagsField value={form.tags} onChange={(tags) => setForm({ ...form, tags })} />
    </EditorShell>
  );
}

function ColorSwatch({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | null | undefined;
  onChange: (v: string | null) => void;
}) {
  return (
    <div className="flex items-center gap-1 text-sm">
      <span className="text-content-300">{label}</span>
      <Tooltip content={value ?? "not set"}>
        <input
          type="color"
          value={value ?? "#888888"}
          onChange={(e) => onChange(e.target.value)}
          className={cn(
            // the native swatch pseudo-elements keep their own padding/corners — flatten
            // them so the circle is the color, not a rounded box around a square
            "size-6 shrink-0 cursor-pointer appearance-none overflow-hidden rounded-full border border-base-400 bg-transparent",
            "[&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-none",
            "[&::-moz-color-swatch]:rounded-full [&::-moz-color-swatch]:border-none",
            !value && "opacity-35"
          )}
        />
      </Tooltip>
      {value != null && (
        <Button variant="ghost" size="sm" shape="square" title="Clear" onClick={() => onChange(null)}><X /></Button>
      )}
    </div>
  );
}

function AudioVisualFields({ form, setForm }: { form: any; setForm: (f: any) => void }) {
  const style = form.stageStyle ?? {};
  const setStyle = (patch: any) => {
    const next = { ...style, ...patch };
    const empty = Object.values(next).every((v) => v == null);
    setForm({ ...form, stageStyle: empty ? null : next });
  };
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <AssetInput label="Artwork (16:9 background)" kind="image" ratio={16 / 9} value={form.artworkAsset ?? null} onChange={(v) => setForm({ ...form, artworkAsset: v })} />
        <div className="space-y-3">
          <AssetInput label="BGM (loops)" kind="audio" value={form.bgmAsset ?? null} onChange={(v) => setForm({ ...form, bgmAsset: v })} />
          <AssetInput label="Ambient SFX (loops)" kind="audio" value={form.ambientAsset ?? null} onChange={(v) => setForm({ ...form, ambientAsset: v })} />
        </div>
      </div>
      <Field label="Image prompt" hint="text-to-image prompt for the background — generate the art elsewhere, upload it above">
        <Textarea className="w-full h-20" value={form.imagePrompt ?? ""} onChange={(v) => setForm({ ...form, imagePrompt: v })} />
      </Field>
      <Collapsible bordered title={`Chat style${style.enabled === true ? " — enabled" : ""}`}>
        <div className="text-xs text-content-400 mb-2">
          colors the VN stage & floating chat panel while this place is active — governed by the
          scene/location styling switch in Settings; message text auto-contrasts with its background
          when unset
        </div>
        <div className="space-y-2">
        <Checkbox
          value={style.enabled === true}
          onChange={(v) => setStyle({ enabled: v ? true : null })}
          label="Apply this style in chat (off by default)"
        />
        <div className={cn("flex items-center gap-4 flex-wrap", style.enabled !== true && "opacity-40 pointer-events-none")}>
          <ColorSwatch label="Stage bg" value={style.stageBg} onChange={(v) => setStyle({ stageBg: v })} />
          <ColorSwatch label="Panel bg" value={style.panelBg} onChange={(v) => setStyle({ panelBg: v })} />
          <ColorSwatch label="Message bg" value={style.messageBg} onChange={(v) => setStyle({ messageBg: v })} />
          <ColorSwatch label="Message text" value={style.messageFg} onChange={(v) => setStyle({ messageFg: v })} />
          <ColorSwatch label="Panel text" value={style.panelFg} onChange={(v) => setStyle({ panelFg: v })} />
          <ColorSwatch label="Accent" value={style.accent} onChange={(v) => setStyle({ accent: v })} />
          <ColorSwatch label="Accent text" value={style.accentFg} onChange={(v) => setStyle({ accentFg: v })} />
        </div>
        </div>
      </Collapsible>
    </>
  );
}

/** The location sheet fields, shell-free — shared by the library editor dialog and
 *  the story page (a story's embedded locations, which use literal names, no tags). */
export function LocationFields({ form, setForm, embedded = false }: { form: any; setForm: (f: any) => void; embedded?: boolean }) {
  return (
    <>
      <Field label="Name">
        <Input className="w-full" value={form.name ?? ""} onChange={(v) => setForm({ ...form, name: v })} />
      </Field>
      <Field label="Description" hint={embedded ? "write literal names — story content doesn't use placeholder tags (everything in a story is fixed)" : "placeholders like [char_name], [user_name] work here"}>
        <Textarea className="w-full h-32" value={form.description ?? ""} onChange={(v) => setForm({ ...form, description: v })} />
      </Field>
      <AudioVisualFields form={form} setForm={setForm} />
    </>
  );
}

export function LocationEditor({ initial, onSaved }: { initial: Partial<Location>; onSaved: () => void }) {
  const { form, setForm, save, saving } = useEditor(initial, "/api/locations", onSaved);
  return (
    <EditorShell entityType="location" form={form} setForm={setForm} onSave={save} saving={saving}>
      <LocationFields form={form} setForm={setForm} />
      <TagsField value={form.tags} onChange={(tags) => setForm({ ...form, tags })} />
    </EditorShell>
  );
}

/** The scene sheet fields, shell-free. The location link differs by context —
 *  library scenes pick from the library, a story's embedded scenes from the
 *  story's own locations — so the caller supplies the picker via `locationField`. */
export function SceneFields({
  form,
  setForm,
  locationField,
  embedded = false,
}: {
  form: any;
  setForm: (f: any) => void;
  locationField?: React.ReactNode;
  embedded?: boolean;
}) {
  return (
    <>
      <Field label="Name">
        <Input className="w-full" value={form.name ?? ""} onChange={(v) => setForm({ ...form, name: v })} />
      </Field>
      <Field label="Setup" hint={embedded ? `the situation: what's happening, the stakes, how it opens — write literal names — story content doesn't use placeholder tags (everything in a story is fixed)` : "the situation: what's happening, the stakes, how it opens — placeholders like [char_name], [user_name] work here"}>
        <Textarea className="w-full h-32" value={form.setup ?? ""} onChange={(v) => setForm({ ...form, setup: v })} />
      </Field>
      {locationField}
      <AudioVisualFields form={form} setForm={setForm} />
    </>
  );
}

export function SceneEditor({ initial, onSaved }: { initial: Partial<Scene>; onSaved: () => void }) {
  const { form, setForm, save, saving } = useEditor(initial, "/api/scenes", onSaved);
  const locationName = useEntityName(form.locationId ? `/api/locations/${form.locationId}` : null);
  const locations = useComboboxSearch("/api/locations", {
    selected: form.locationId ? { value: form.locationId, label: locationName ?? "…" } : null,
  });
  return (
    <EditorShell entityType="scene" form={form} setForm={setForm} onSave={save} saving={saving}>
      <SceneFields
        form={form}
        setForm={setForm}
        locationField={
          <Field label="Location" hint="when set, the location's artwork/BGM take precedence in chat">
            <Combobox
              className="w-full"
              value={form.locationId ?? null}
              onChange={(v) => setForm({ ...form, locationId: v })}
              options={locations.options}
              loading={locations.loading}
              hasMore={locations.hasMore}
              isFetchingMore={locations.isFetchingMore}
              onLoadMore={locations.onLoadMore}
              onSearch={locations.onSearch}
              placeholder="(none)"
              clearable
              onClear={() => setForm({ ...form, locationId: null })}
            />
          </Field>
        }
      />
      <TagsField value={form.tags} onChange={(tags) => setForm({ ...form, tags })} />
    </EditorShell>
  );
}

/** The lorebook fields, shell-free — shared by the library editor dialog and the
 *  story page (a story's embedded lorebooks). */
export function LorebookFields({ form, setForm, embedded = false }: { form: any; setForm: (f: any) => void; embedded?: boolean }) {
  const entries: LorebookEntry[] = form.entries ?? [];
  const setEntry = (i: number, patch: Partial<LorebookEntry>) => {
    const next = [...entries];
    next[i] = { ...next[i], ...patch };
    setForm({ ...form, entries: next });
  };
  return (
    <>
      <Field label="Name">
        <Input className="w-full" value={form.name ?? ""} onChange={(v) => setForm({ ...form, name: v })} />
      </Field>
      <Field label="Description">
        <Input className="w-full" value={form.description ?? ""} onChange={(v) => setForm({ ...form, description: v })} />
      </Field>
      <Field label="Entries" hint={embedded ? "injected into the prompt when a keyword appears in recent messages — write literal names — story content doesn't use placeholder tags (everything in a story is fixed)" : "injected into the prompt when a keyword appears in recent messages; placeholders like [char_name] work in content"}>
        <div className="space-y-3">
          {entries.map((en, i) => (
            <div key={en.id ?? i} className="panel p-3 space-y-2">
              <div className="flex gap-2">
                <Input className="flex-1 min-w-0" placeholder="Title" value={en.title} onChange={(v) => setEntry(i, { title: v })} />
                <InputNumber
                  className="w-24 min-w-24"
                  integer
                  title="scan depth (messages)"
                  value={en.scanDepth ?? 8}
                  onChange={(v) => setEntry(i, { scanDepth: v || 8 })}
                />
                <Button variant="ghost" size="sm" shape="square" className="size-8" onClick={() => setForm({ ...form, entries: entries.filter((_, k) => k !== i) })}><X /></Button>
              </div>
              <Input
                className="w-full"
                placeholder="keywords, comma, separated"
                value={en.keywords.join(", ")}
                onChange={(v) => setEntry(i, { keywords: v.split(",").map((s) => s.trim()).filter(Boolean) })}
              />
              <Textarea className="w-full h-20" placeholder="Content" value={en.content} onChange={(v) => setEntry(i, { content: v })} />
            </div>
          ))}
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              setForm({
                ...form,
                entries: [...entries, { id: uid(), title: "", keywords: [], content: "", scanDepth: 8 }],
              })
            }
          >
            + Add entry
          </Button>
        </div>
      </Field>
    </>
  );
}

export function LorebookEditor({ initial, onSaved }: { initial: Partial<Lorebook>; onSaved: () => void }) {
  const { form, setForm, save, saving } = useEditor(initial, "/api/lorebooks", onSaved);
  return (
    <EditorShell entityType="lorebook" form={form} setForm={setForm} onSave={save} saving={saving}>
      <LorebookFields form={form} setForm={setForm} />
      <TagsField value={form.tags} onChange={(tags) => setForm({ ...form, tags })} />
    </EditorShell>
  );
}
