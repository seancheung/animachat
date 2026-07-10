"use client";

import { useState } from "react";
import useSWR from "swr";
import { AssistPanel } from "@/components/AssistPanel";
import { AssetInput } from "@/components/AssetInput";
import { Field } from "@/components/ui";
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
          <button className="btn btn-primary" onClick={onSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
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
      alert(e.message);
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
        <input className="input" value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </Field>
      <Field label="Description" hint="who you are in the roleplay — characters see this">
        <textarea className="input h-40" value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} />
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
        <textarea className="input h-20" value={form.imagePrompt ?? ""} onChange={(e) => setForm({ ...form, imagePrompt: e.target.value })} />
      </Field>
    </>
  );
}

export function LocationEditor({ initial, onSaved }: { initial: Partial<Location>; onSaved: () => void }) {
  const { form, setForm, save, saving } = useEditor(initial, "/api/locations", onSaved);
  return (
    <EditorShell entityType="location" form={form} setForm={setForm} onSave={save} saving={saving}>
      <Field label="Name">
        <input className="input" value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </Field>
      <Field label="Description">
        <textarea className="input h-32" value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} />
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
        <input className="input" value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </Field>
      <Field label="Setup" hint="the situation: what's happening, the stakes, how it opens">
        <textarea className="input h-32" value={form.setup ?? ""} onChange={(e) => setForm({ ...form, setup: e.target.value })} />
      </Field>
      <Field label="Location" hint="when set, the location's artwork/BGM take precedence in chat">
        <select className="input" value={form.locationId ?? ""} onChange={(e) => setForm({ ...form, locationId: e.target.value || null })}>
          <option value="">(none)</option>
          {locations?.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
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
        <input className="input" value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </Field>
      <Field label="Description" hint="premise and arc — the narrator uses this to steer the plot">
        <textarea className="input h-28" value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </Field>
      <Field label="Scenes (in order)">
        <div className="space-y-1">
          {sceneIds.map((sid, i) => (
            <div key={`${sid}-${i}`} className="flex items-center gap-2 bg-[var(--bg-soft)] rounded-lg px-3 py-1.5 text-sm">
              <span className="text-[var(--text-dim)]">{i + 1}.</span>
              <span className="flex-1">{scenes?.find((s) => s.id === sid)?.name ?? "?"}</span>
              <button className="btn btn-sm btn-ghost" onClick={() => move(i, -1)}>↑</button>
              <button className="btn btn-sm btn-ghost" onClick={() => move(i, 1)}>↓</button>
              <button className="btn btn-sm btn-ghost" onClick={() => setForm({ ...form, sceneIds: sceneIds.filter((_, k) => k !== i) })}>✕</button>
            </div>
          ))}
          <select
            className="input"
            value=""
            onChange={(e) => e.target.value && setForm({ ...form, sceneIds: [...sceneIds, e.target.value] })}
          >
            <option value="">+ add scene…</option>
            {scenes?.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
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
        <input className="input" value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </Field>
      <Field label="Description">
        <input className="input" value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </Field>
      <Field label="Entries" hint="injected into the prompt when a keyword appears in recent messages">
        <div className="space-y-3">
          {entries.map((en, i) => (
            <div key={en.id ?? i} className="panel p-3 space-y-2">
              <div className="flex gap-2">
                <input className="input" placeholder="Title" value={en.title} onChange={(e) => setEntry(i, { title: e.target.value })} />
                <input
                  className="input w-24"
                  type="number"
                  title="scan depth (messages)"
                  value={en.scanDepth ?? 8}
                  onChange={(e) => setEntry(i, { scanDepth: Number(e.target.value) || 8 })}
                />
                <button className="btn btn-sm btn-ghost" onClick={() => setForm({ ...form, entries: entries.filter((_, k) => k !== i) })}>✕</button>
              </div>
              <input
                className="input"
                placeholder="keywords, comma, separated"
                value={en.keywords.join(", ")}
                onChange={(e) => setEntry(i, { keywords: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
              />
              <textarea className="input h-20" placeholder="Content" value={en.content} onChange={(e) => setEntry(i, { content: e.target.value })} />
            </div>
          ))}
          <button
            className="btn btn-sm"
            onClick={() =>
              setForm({
                ...form,
                entries: [...entries, { id: crypto.randomUUID(), title: "", keywords: [], content: "", scanDepth: 8 }],
              })
            }
          >
            + Add entry
          </button>
        </div>
      </Field>
    </EditorShell>
  );
}
