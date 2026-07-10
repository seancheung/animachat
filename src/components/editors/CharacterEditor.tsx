"use client";

import { AssetInput } from "@/components/AssetInput";
import { Field } from "@/components/ui";
import { EMOTIONS, type Character, type CustomExpression } from "@/lib/types";
import { EditorShell, useEditor } from "./SimpleEditors";

export function CharacterEditor({ initial, onSaved }: { initial: Partial<Character>; onSaved: () => void }) {
  const { form, setForm, save, saving } = useEditor(initial, "/api/characters", onSaved);
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
      <Field label="Personality" hint="personality, background, mannerisms — the core of the character">
        <textarea className="input h-36" value={form.personality ?? ""} onChange={(e) => setForm({ ...form, personality: e.target.value })} />
      </Field>
      <Field label="Example dialogue" hint="a few example exchanges showing their voice">
        <textarea className="input h-24" value={form.exampleDialogue ?? ""} onChange={(e) => setForm({ ...form, exampleDialogue: e.target.value })} />
      </Field>
      <Field label="Image prompt" hint="text-to-image prompt for the neutral sprite (2:3) — generate elsewhere, upload below">
        <textarea className="input h-20" value={form.imagePrompt ?? ""} onChange={(e) => setForm({ ...form, imagePrompt: e.target.value })} />
      </Field>

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
                ✕
              </button>
            </div>
          ))}
          <button
            className="btn btn-sm"
            onClick={() => setForm({ ...form, customExpressions: [...customs, { name: "", description: "" }] })}
          >
            + Add custom expression
          </button>
        </div>
      </Field>

      <div className="w-56">
        <AssetInput label="Typing sound override" kind="audio" value={form.typingSfxAsset ?? null} onChange={(v) => setForm({ ...form, typingSfxAsset: v })} />
      </div>
    </EditorShell>
  );
}
