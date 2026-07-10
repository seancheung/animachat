"use client";

import useSWR from "swr";
import { Heart, Plus, Trash2, X } from "lucide-react";
import { AssetInput } from "@/components/AssetInput";
import { Field, Toggle } from "@/components/ui";
import { api } from "@/lib/ui";
import { EMOTIONS, type Character, type CustomExpression } from "@/lib/types";
import { EditorShell, useEditor } from "./SimpleEditors";

const PLACEHOLDER_HINT =
  "placeholders work here: [char_name], [char_2_name], [user_name], [loc_name], [scene_name], [story_name]";

function RelationshipsCard({ characterId }: { characterId: string }) {
  const { data, mutate } = useSWR<
    { personaId: string; personaName: string; affinity: number; notes: string }[]
  >(`/api/characters/${characterId}/relationships`, api.get);
  if (!data?.length) return <div className="text-xs text-[var(--text-dim)]">no relationship data yet</div>;
  return (
    <div className="space-y-2">
      {data.map((r) => (
        <div key={r.personaId} className="panel p-2.5">
          <div className="flex justify-between text-sm">
            <span className="inline-flex items-center gap-1">
              <Heart size={12} className="text-[var(--accent-2)]" /> with {r.personaName}
            </span>
            <span className="text-[var(--text-dim)]">affinity {r.affinity}</span>
          </div>
          <div className="h-1.5 rounded bg-[var(--bg-soft)] mt-1 overflow-hidden">
            <div className="h-full bg-gradient-to-r from-[#7c3aed] to-[#f0abfc]" style={{ width: `${(r.affinity + 100) / 2}%` }} />
          </div>
          {r.notes && <div className="text-xs text-[var(--text-dim)] mt-1">{r.notes}</div>}
        </div>
      ))}
      <button
        className="btn btn-sm btn-danger"
        onClick={async () => {
          if (!confirm("Reset this character's relationship data with all personas?")) return;
          await api.del(`/api/characters/${characterId}/relationships`);
          mutate();
        }}
      >
        <Trash2 size={13} /> Reset relationships
      </button>
    </div>
  );
}

export function CharacterEditor({ initial, onSaved }: { initial: Partial<Character>; onSaved: () => void }) {
  const { form, setForm, save, saving } = useEditor(
    { trackRelationship: true, idleMotion: true, ...initial },
    "/api/characters",
    onSaved
  );
  const sprites: Record<string, string> = form.sprites ?? {};
  const customs: CustomExpression[] = form.customExpressions ?? [];
  const setSprite = (emotion: string, assetId: string | null) => {
    const next = { ...sprites };
    if (assetId) next[emotion] = assetId;
    else delete next[emotion];
    setForm({ ...form, sprites: next });
  };

  return (
    <EditorShell entityType="character" form={form} setForm={setForm} onSave={save} saving={saving}>
      <div className="grid grid-cols-[120px_1fr] gap-3">
        <AssetInput label="Avatar (1:1)" kind="image" ratio={1} value={form.avatarAsset ?? null} onChange={(v) => setForm({ ...form, avatarAsset: v })} />
        <div className="space-y-3">
          <Field label="Name">
            <input className="input" value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Greeting" hint="their opening message when a chat starts">
            <textarea className="input h-20" value={form.greeting ?? ""} onChange={(e) => setForm({ ...form, greeting: e.target.value })} />
          </Field>
        </div>
      </div>
      <Field label="Description" hint={`personality, background, mannerisms, anything else — ${PLACEHOLDER_HINT}`}>
        <textarea className="input h-36" value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </Field>
      <Field label="Example dialogue" hint="a few example exchanges showing their voice">
        <textarea className="input h-24" value={form.exampleDialogue ?? ""} onChange={(e) => setForm({ ...form, exampleDialogue: e.target.value })} />
      </Field>
      <Field label="Image prompt" hint="text-to-image prompt for the neutral sprite (2:3) — generate elsewhere, upload below">
        <textarea className="input h-20" value={form.imagePrompt ?? ""} onChange={(e) => setForm({ ...form, imagePrompt: e.target.value })} />
      </Field>

      <div className="flex gap-6">
        <Toggle checked={form.trackRelationship ?? true} onChange={(v) => setForm({ ...form, trackRelationship: v })} label="Track relationship/affinity with personas" />
        <Toggle checked={form.idleMotion ?? true} onChange={(v) => setForm({ ...form, idleMotion: v })} label="Idle motion on stage" />
      </div>
      {form.id && (form.trackRelationship ?? true) && (
        <Field label="Relationships">
          <RelationshipsCard characterId={form.id} />
        </Field>
      )}

      <Field label="Expression sprites (2:3)" hint="all optional — neutral is the fallback; missing expressions fall back to neutral, then the placeholder">
        <div className="grid grid-cols-4 gap-2">
          {EMOTIONS.map((emo) => (
            <div key={emo}>
              <AssetInput kind="image" ratio={2 / 3} value={sprites[emo] ?? null} onChange={(v) => setSprite(emo, v)} />
              <div className="text-center text-xs text-[var(--text-dim)] mt-0.5">{emo}</div>
            </div>
          ))}
        </div>
      </Field>

      <Field label="Custom expressions" hint="the description teaches the AI when to pick it">
        <div className="space-y-2">
          {customs.map((c, i) => (
            <div key={i} className="flex gap-2 items-start">
              <div className="w-20 shrink-0">
                <AssetInput kind="image" ratio={2 / 3} value={sprites[c.name] ?? null} onChange={(v) => setSprite(c.name, v)} />
              </div>
              <div className="flex-1 space-y-1">
                <input
                  className="input"
                  placeholder="name (kebab-case)"
                  value={c.name}
                  onChange={(e) => {
                    const name = e.target.value.toLowerCase().replace(/\s+/g, "-");
                    const next = [...customs];
                    const oldName = next[i].name;
                    next[i] = { ...next[i], name };
                    const s = { ...sprites };
                    if (s[oldName]) {
                      s[name] = s[oldName];
                      delete s[oldName];
                    }
                    setForm({ ...form, customExpressions: next, sprites: s });
                  }}
                />
                <input
                  className="input"
                  placeholder="when to use it"
                  value={c.description}
                  onChange={(e) => {
                    const next = [...customs];
                    next[i] = { ...next[i], description: e.target.value };
                    setForm({ ...form, customExpressions: next });
                  }}
                />
              </div>
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => {
                  const s = { ...sprites };
                  delete s[c.name];
                  setForm({ ...form, customExpressions: customs.filter((_, k) => k !== i), sprites: s });
                }}
              >
                <X size={14} />
              </button>
            </div>
          ))}
          <button
            className="btn btn-sm"
            onClick={() => setForm({ ...form, customExpressions: [...customs, { name: "", description: "" }] })}
          >
            <Plus size={14} /> Add custom expression
          </button>
        </div>
      </Field>

      <div className="w-56">
        <AssetInput label="Typing sound override" kind="audio" value={form.typingSfxAsset ?? null} onChange={(v) => setForm({ ...form, typingSfxAsset: v })} />
      </div>
    </EditorShell>
  );
}
