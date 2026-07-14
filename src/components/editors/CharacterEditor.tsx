"use client";

import useSWR from "swr";
import { Heart, Plus, Trash2, X } from "lucide-react";
import { AssetInput } from "@/components/AssetInput";
import { Field } from "@/components/app";
import { confirmDialog } from "@/components/confirm";
import Button from "@/components/ui/button";
import Input from "@/components/ui/input";
import Progress from "@/components/ui/progress";
import Switch from "@/components/ui/switch";
import Textarea from "@/components/ui/textarea";
import { api } from "@/lib/ui";
import { EMOTIONS, type Character, type CustomExpression } from "@/lib/types";
import { EditorShell, TagsField, useEditor } from "./SimpleEditors";

const PLACEHOLDER_HINT =
  "placeholders work here: [char_name], [char2_name], [user_name], [loc_name], [scene_name], [story_name]";

function RelationshipsCard({ characterId }: { characterId: string }) {
  const { data, mutate } = useSWR<{
    personas: { personaId: string; personaName: string; affinity: number; notes: string }[];
    characters: { otherId: string; otherName: string; affinity: number; notes: string }[];
  }>(`/api/characters/${characterId}/relationships`, api.get);
  const rows = [
    ...(data?.personas ?? []).map((r) => ({ key: `p-${r.personaId}`, name: r.personaName, ...r })),
    ...(data?.characters ?? []).map((r) => ({ key: `c-${r.otherId}`, name: r.otherName, ...r })),
  ];
  if (!rows.length) return <div className="text-xs text-content-400">no relationship data yet</div>;
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.key} className="panel p-2.5">
          <div className="flex justify-between text-sm">
            <span className="inline-flex items-center gap-1">
              <Heart size={12} className="text-primary-400" /> with {r.name}
            </span>
            <span className="text-content-300">affinity {r.affinity}</span>
          </div>
          <Progress className="mt-1.5" value={(r.affinity + 100) / 2} />
          {r.notes && <div className="text-xs text-content-300 mt-1">{r.notes}</div>}
        </div>
      ))}
      <Button
        variant="danger"
        size="sm"
        onClick={async () => {
          if (!(await confirmDialog({ title: "Reset relationships", message: "Reset this character's relationship data with all personas and characters?", confirmLabel: "Reset", danger: true }))) return;
          await api.del(`/api/characters/${characterId}/relationships`);
          mutate();
        }}
      >
        <Trash2 /> Reset relationships
      </Button>
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
            <Input className="w-full" value={form.name ?? ""} onChange={(v) => setForm({ ...form, name: v })} />
          </Field>
          <Field label="Greeting" hint="their opening message when a chat starts">
            <Textarea className="w-full h-20" value={form.greeting ?? ""} onChange={(v) => setForm({ ...form, greeting: v })} />
          </Field>
        </div>
      </div>
      <Field label="Description" hint={`personality, background, mannerisms, anything else — ${PLACEHOLDER_HINT}`}>
        <Textarea className="w-full h-36" value={form.description ?? ""} onChange={(v) => setForm({ ...form, description: v })} />
      </Field>
      <Field label="Example dialogue" hint="a few example exchanges showing their voice">
        <Textarea className="w-full h-24" value={form.exampleDialogue ?? ""} onChange={(v) => setForm({ ...form, exampleDialogue: v })} />
      </Field>
      <Field label="Image prompt" hint="text-to-image prompt for the neutral sprite (2:3) — generate elsewhere, upload below">
        <Textarea className="w-full h-20" value={form.imagePrompt ?? ""} onChange={(v) => setForm({ ...form, imagePrompt: v })} />
      </Field>

      <div className="flex gap-6">
        <Switch value={form.trackRelationship ?? true} onChange={(v) => setForm({ ...form, trackRelationship: v })} label="Track relationship/affinity with personas" />
        <Switch value={form.idleMotion ?? true} onChange={(v) => setForm({ ...form, idleMotion: v })} label="Idle motion on stage" />
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
              <div className="text-center text-xs text-content-300 mt-0.5">{emo}</div>
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
                <Input
                  className="w-full"
                  placeholder="name (kebab-case)"
                  value={c.name}
                  onChange={(raw) => {
                    const name = raw.toLowerCase().replace(/\s+/g, "-");
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
                <Input
                  className="w-full"
                  placeholder="when to use it"
                  value={c.description}
                  onChange={(v) => {
                    const next = [...customs];
                    next[i] = { ...next[i], description: v };
                    setForm({ ...form, customExpressions: next });
                  }}
                />
              </div>
              <Button
                variant="ghost"
                size="sm"
                shape="square"
                onClick={() => {
                  const s = { ...sprites };
                  delete s[c.name];
                  setForm({ ...form, customExpressions: customs.filter((_, k) => k !== i), sprites: s });
                }}
              >
                <X />
              </Button>
            </div>
          ))}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setForm({ ...form, customExpressions: [...customs, { name: "", description: "" }] })}
          >
            <Plus /> Add custom expression
          </Button>
        </div>
      </Field>

      <div className="w-56">
        <AssetInput label="Typing sound override" kind="audio" value={form.typingSfxAsset ?? null} onChange={(v) => setForm({ ...form, typingSfxAsset: v })} />
      </div>

      <TagsField value={form.tags} onChange={(tags) => setForm({ ...form, tags })} />
    </EditorShell>
  );
}
