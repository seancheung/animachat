"use client";

import { useState } from "react";
import useSWR from "swr";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { AssistPanel } from "@/components/AssistPanel";
import { AssetInput } from "@/components/AssetInput";
import { Field } from "@/components/app";
import Button from "@/components/ui/button";
import Input from "@/components/ui/input";
import InputNumber from "@/components/ui/input-number";
import Select from "@/components/ui/select";
import Textarea from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/ui";
import type { Location, Lorebook, LorebookEntry, Persona, Scene, Story } from "@/lib/types";

/* eslint-disable @typescript-eslint/no-explicit-any */

export function EditorShell({
  entityType,
  form,
  setForm,
  onSave,
  saving,
  children,
  assist = true,
}: {
  entityType: string;
  form: any;
  setForm: (f: any) => void;
  onSave: () => void;
  saving: boolean;
  children: React.ReactNode;
  assist?: boolean;
}) {
  return (
    <div className={assist ? "grid grid-cols-[1fr_320px] gap-4 h-[70vh]" : ""}>
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
          onFields={(partial) => setForm({ ...form, ...partial })}
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
    </EditorShell>
  );
}

function AudioVisualFields({ form, setForm }: { form: any; setForm: (f: any) => void }) {
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
    </>
  );
}

export function LocationEditor({ initial, onSaved }: { initial: Partial<Location>; onSaved: () => void }) {
  const { form, setForm, save, saving } = useEditor(initial, "/api/locations", onSaved);
  return (
    <EditorShell entityType="location" form={form} setForm={setForm} onSave={save} saving={saving}>
      <Field label="Name">
        <Input className="w-full" value={form.name ?? ""} onChange={(v) => setForm({ ...form, name: v })} />
      </Field>
      <Field label="Description" hint="placeholders like [char_name], [user_name] work here">
        <Textarea className="w-full h-32" value={form.description ?? ""} onChange={(v) => setForm({ ...form, description: v })} />
      </Field>
      <AudioVisualFields form={form} setForm={setForm} />
    </EditorShell>
  );
}

export function SceneEditor({ initial, onSaved }: { initial: Partial<Scene>; onSaved: () => void }) {
  const { form, setForm, save, saving } = useEditor(initial, "/api/scenes", onSaved);
  const { data: locations } = useSWR<Location[]>("/api/locations", api.get);
  return (
    <EditorShell entityType="scene" form={form} setForm={setForm} onSave={save} saving={saving}>
      <Field label="Name">
        <Input className="w-full" value={form.name ?? ""} onChange={(v) => setForm({ ...form, name: v })} />
      </Field>
      <Field label="Setup" hint="the situation: what's happening, the stakes, how it opens — placeholders like [char_name], [user_name] work here">
        <Textarea className="w-full h-32" value={form.setup ?? ""} onChange={(v) => setForm({ ...form, setup: v })} />
      </Field>
      <Field label="Location" hint="when set, the location's artwork/BGM take precedence in chat">
        <Select
          className="w-full"
          value={form.locationId ?? null}
          onChange={(v) => setForm({ ...form, locationId: v })}
          options={locations?.map((l) => ({ value: l.id, label: l.name })) ?? []}
          placeholder="(none)"
          clearable
          onClear={() => setForm({ ...form, locationId: null })}
        />
      </Field>
      <AudioVisualFields form={form} setForm={setForm} />
    </EditorShell>
  );
}

export function StoryEditor({ initial, onSaved }: { initial: Partial<Story>; onSaved: () => void }) {
  const { form, setForm, save, saving } = useEditor(initial, "/api/stories", onSaved);
  const { data: scenes } = useSWR<Scene[]>("/api/scenes", api.get);
  const sceneIds: string[] = form.sceneIds ?? [];
  const move = (i: number, d: number) => {
    const next = [...sceneIds];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setForm({ ...form, sceneIds: next });
  };
  return (
    <EditorShell entityType="story" form={form} setForm={setForm} onSave={save} saving={saving}>
      <Field label="Name">
        <Input className="w-full" value={form.name ?? ""} onChange={(v) => setForm({ ...form, name: v })} />
      </Field>
      <Field label="Description" hint="premise and arc — the narrator uses this to steer the plot; placeholders like [char_name], [user_name] work here">
        <Textarea className="w-full h-28" value={form.description ?? ""} onChange={(v) => setForm({ ...form, description: v })} />
      </Field>
      <Field label="Scenes (in order)">
        <div className="space-y-1">
          {sceneIds.map((sid, i) => (
            <div key={`${sid}-${i}`} className="flex items-center gap-2 bg-base-200 rounded-md px-3 py-1.5 text-sm">
              <span className="text-content-300">{i + 1}.</span>
              <span className="flex-1">{scenes?.find((s) => s.id === sid)?.name ?? "?"}</span>
              <Button variant="ghost" size="sm" shape="square" onClick={() => move(i, -1)}><ArrowUp /></Button>
              <Button variant="ghost" size="sm" shape="square" onClick={() => move(i, 1)}><ArrowDown /></Button>
              <Button variant="ghost" size="sm" shape="square" onClick={() => setForm({ ...form, sceneIds: sceneIds.filter((_, k) => k !== i) })}><X /></Button>
            </div>
          ))}
          <Select
            className="w-full"
            value={null}
            onChange={(v) => v && setForm({ ...form, sceneIds: [...sceneIds, v] })}
            options={scenes?.map((s) => ({ value: s.id, label: s.name })) ?? []}
            placeholder="+ add scene…"
          />
        </div>
      </Field>
    </EditorShell>
  );
}

export function LorebookEditor({ initial, onSaved }: { initial: Partial<Lorebook>; onSaved: () => void }) {
  const { form, setForm, save, saving } = useEditor(initial, "/api/lorebooks", onSaved);
  const entries: LorebookEntry[] = form.entries ?? [];
  const setEntry = (i: number, patch: Partial<LorebookEntry>) => {
    const next = [...entries];
    next[i] = { ...next[i], ...patch };
    setForm({ ...form, entries: next });
  };
  return (
    <EditorShell entityType="lorebook" form={form} setForm={setForm} onSave={save} saving={saving}>
      <Field label="Name">
        <Input className="w-full" value={form.name ?? ""} onChange={(v) => setForm({ ...form, name: v })} />
      </Field>
      <Field label="Description">
        <Input className="w-full" value={form.description ?? ""} onChange={(v) => setForm({ ...form, description: v })} />
      </Field>
      <Field label="Entries" hint="injected into the prompt when a keyword appears in recent messages; placeholders like [char_name] work in content">
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
                entries: [...entries, { id: crypto.randomUUID(), title: "", keywords: [], content: "", scanDepth: 8 }],
              })
            }
          >
            + Add entry
          </Button>
        </div>
      </Field>
    </EditorShell>
  );
}
