"use client";

import { Heart, Plus, Trash2, X } from "lucide-react";
import { AssetInput } from "@/components/AssetInput";
import { Field } from "@/components/app";
import { confirmDialog } from "@/components/confirm";
import Button from "@/components/ui/button";
import Collapsible from "@/components/ui/collapsible";
import Input from "@/components/ui/input";
import Progress from "@/components/ui/progress";
import Select from "@/components/ui/select";
import Switch from "@/components/ui/switch";
import Textarea from "@/components/ui/textarea";
import { useGet, usePagedList } from "@/lib/queries";
import { api } from "@/lib/ui";
import {
  alivenessOf,
  EMOTIONS,
  type Aliveness,
  type Character,
  type CustomExpression,
  type OffscreenLifeMode,
} from "@/lib/types";
import { EditorShell, TagsField, useEditor } from "./SimpleEditors";

const PLACEHOLDER_HINT =
  "placeholders work here: [char_name], [char2_name], [user_name], [loc_name], [scene_name], [story_name]";

function RelationshipsCard({ characterId }: { characterId: string }) {
  const { data, refetch: mutate } = useGet<{
    personas: { personaId: string; personaName: string; affinity: number; notes: string }[];
    characters: { otherId: string; otherName: string; affinity: number; notes: string }[];
  }>(`/api/characters/${characterId}/relationships`);
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

/** Read-only view of the character's extracted facts (cross-chat memory) — the
 *  memory pass maintains them; inspection only, no editing. */
function FactsCard({ characterId }: { characterId: string }) {
  const facts = usePagedList<{ id: string; content: string; createdAt: number; chatTitle: string | null }>(
    `/api/characters/${characterId}/facts`
  );
  if (!facts.items.length)
    return <div className="text-xs text-content-400">no remembered facts yet</div>;
  return (
    <div className="space-y-2">
      {facts.items.map((f) => (
        <div key={f.id} className="panel p-2.5 space-y-0.5">
          <div className="text-xs text-content-200">{f.content}</div>
          <div className="text-xs text-content-400">
            {new Date(f.createdAt).toLocaleDateString()}
            {f.chatTitle ? ` — in “${f.chatTitle}”` : ""}
          </div>
        </div>
      ))}
      {facts.hasNextPage && (
        <Button
          variant="secondary"
          size="sm"
          disabled={facts.isFetchingNextPage}
          onClick={() => void facts.fetchNextPage()}
        >
          Load more
        </Button>
      )}
    </div>
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/** A settings row: label + muted description on the left, the control on the right. */
function TraitRow({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-4 py-2.5">
      <div className="flex-1 min-w-0">
        <div className="text-sm">{label}</div>
        <div className="text-xs text-content-400 mt-0.5">{description}</div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** Aliveness traits — casual/immersive chats only (playthroughs pace themselves),
 *  which is also why the story page's embedded character editors don't show them. */
function AlivenessFields({ form, setForm }: { form: any; setForm: (f: any) => void }) {
  const a = alivenessOf(form);
  const patch = (p: Partial<Aliveness>) => setForm({ ...form, aliveness: { ...a, ...p } });
  return (
    <Collapsible bordered title="Aliveness">
      <div className="text-xs text-content-400">all off by default — applies in casual & immersive chats</div>
      <div className="divide-y divide-base-400">
        <TraitRow
          label="Initiative"
          description="They bring up their own topics, opinions, moods and wants — callbacks, disagreements, subject changes. Off = purely reactive."
        >
          <Switch value={a.initiative} onChange={(v) => patch({ initiative: v })} />
        </TraitRow>
        <TraitRow
          label="Time awareness"
          description="Notices how long you've been away and remembers when things happened. Real elapsed time — leave off for period or fantasy characters."
        >
          <Switch value={a.timeAware} onChange={(v) => patch({ timeAware: v })} />
        </TraitRow>
        <TraitRow
          label="State of mind"
          description="Carries an evolving mood, wants and unresolved threads between sessions. Kept per chat, updated by the memory pass."
        >
          <Switch value={a.mindState} onChange={(v) => patch({ mindState: v })} />
        </TraitRow>
        <TraitRow
          label="Off-screen life"
          description="After 6+ hours away (casual chats), they've been up to something meanwhile. Background colors their replies; Texts first also has them open the conversation when you return."
        >
          <Select<OffscreenLifeMode>
            value={a.offscreenLife}
            onChange={(v) => patch({ offscreenLife: v })}
            options={[
              { value: "off", label: "Off" },
              { value: "context", label: "Background" },
              { value: "texts", label: "Texts first" },
            ]}
            className="min-w-0"
          />
        </TraitRow>
      </div>
    </Collapsible>
  );
}

/**
 * The character sheet fields, shell-free — used by the library editor dialog and,
 * with `embedded`, by the story page for a story's owned cast members (embedded
 * characters have no relationship tracking and no library tags).
 */
export function CharacterFields({
  form,
  setForm,
  embedded = false,
}: {
  form: any;
  setForm: (f: any) => void;
  embedded?: boolean;
}) {
  const sprites: Record<string, string> = form.sprites ?? {};
  const spriteSfx: Record<string, string> = form.spriteSfx ?? {};
  const customs: CustomExpression[] = form.customExpressions ?? [];
  const setSprite = (emotion: string, assetId: string | null) => {
    const next = { ...sprites };
    if (assetId) next[emotion] = assetId;
    else delete next[emotion];
    setForm({ ...form, sprites: next });
  };
  const setSfx = (emotion: string, assetId: string | null) => {
    const next = { ...spriteSfx };
    if (assetId) next[emotion] = assetId;
    else delete next[emotion];
    setForm({ ...form, spriteSfx: next });
  };
  /** rename/remove a custom expression: its sprite AND its SFX follow the key */
  const rekey = (map: Record<string, string>, from: string, to: string | null) => {
    const next = { ...map };
    if (to && next[from]) next[to] = next[from];
    delete next[from];
    return next;
  };

  return (
    <>
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
      <Field label="Description" hint={`personality, background, mannerisms, anything else — ${embedded ? "write literal names — story content doesn't use placeholder tags (everything in a story is fixed)" : PLACEHOLDER_HINT}`}>
        <Textarea className="w-full h-36" value={form.description ?? ""} onChange={(v) => setForm({ ...form, description: v })} />
      </Field>
      <Field label="Example dialogue" hint="a few short lines in their own voice only — one utterance per line, never other speakers' turns">
        <Textarea className="w-full h-24" value={form.exampleDialogue ?? ""} onChange={(v) => setForm({ ...form, exampleDialogue: v })} />
      </Field>
      <Field label="Image prompt" hint="text-to-image prompt for the neutral sprite (2:3) — generate elsewhere, upload below">
        <Textarea className="w-full h-20" value={form.imagePrompt ?? ""} onChange={(v) => setForm({ ...form, imagePrompt: v })} />
      </Field>

      <div className="flex gap-6">
        {!embedded && (
          <Switch value={form.trackRelationship ?? true} onChange={(v) => setForm({ ...form, trackRelationship: v })} label="Track relationship/affinity with personas" />
        )}
        <Switch value={form.idleMotion ?? true} onChange={(v) => setForm({ ...form, idleMotion: v })} label="Idle motion on stage" />
      </div>
      {!embedded && form.id && (form.trackRelationship ?? true) && (
        <Field label="Relationships">
          <RelationshipsCard characterId={form.id} />
        </Field>
      )}
      {!embedded && form.id && (
        <Field label="Remembered facts" hint="what the memory pass has recorded about them across chats — read-only">
          <FactsCard characterId={form.id} />
        </Field>
      )}

      {!embedded && <AlivenessFields form={form} setForm={setForm} />}

      <Collapsible
        bordered
        title={`Expression sprites (2:3)${(() => { const n = EMOTIONS.filter((e) => sprites[e]).length; return n ? ` — ${n} uploaded` : ""; })()}`}
      >
        <div className="text-xs text-content-400 mb-2">
          all optional — neutral is the fallback; missing expressions fall back to neutral, then the
          placeholder. The audio slot under each is a one-shot SFX (laughter, sigh…) played when the
          character switches to that expression
        </div>
        <div className="grid grid-cols-4 gap-2">
          {EMOTIONS.map((emo) => (
            <div key={emo}>
              <AssetInput kind="image" ratio={2 / 3} value={sprites[emo] ?? null} onChange={(v) => setSprite(emo, v)} />
              <div className="text-center text-xs text-content-300 mt-0.5">{emo}</div>
              <AssetInput kind="audio" value={spriteSfx[emo] ?? null} onChange={(v) => setSfx(emo, v)} />
            </div>
          ))}
        </div>
      </Collapsible>

      <Collapsible bordered title={`Custom expressions${customs.length ? ` — ${customs.length}` : ""}`}>
        <div className="text-xs text-content-400 mb-2">the description teaches the AI when to pick it</div>
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
                    setForm({
                      ...form,
                      customExpressions: next,
                      sprites: rekey(sprites, oldName, name),
                      spriteSfx: rekey(spriteSfx, oldName, name),
                    });
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
                <div className="w-40">
                  <AssetInput kind="audio" value={spriteSfx[c.name] ?? null} onChange={(v) => setSfx(c.name, v)} />
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                shape="square"
                onClick={() =>
                  setForm({
                    ...form,
                    customExpressions: customs.filter((_, k) => k !== i),
                    sprites: rekey(sprites, c.name, null),
                    spriteSfx: rekey(spriteSfx, c.name, null),
                  })
                }
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
      </Collapsible>

      <div className="w-56">
        <AssetInput label="Typing sound override" kind="audio" value={form.typingSfxAsset ?? null} onChange={(v) => setForm({ ...form, typingSfxAsset: v })} />
      </div>
    </>
  );
}

export function CharacterEditor({ initial, onSaved }: { initial: Partial<Character>; onSaved: () => void }) {
  const { form, setForm, save, saving } = useEditor(
    { trackRelationship: true, idleMotion: true, ...initial },
    "/api/characters",
    onSaved
  );
  return (
    <EditorShell entityType="character" form={form} setForm={setForm} onSave={save} saving={saving}>
      <CharacterFields form={form} setForm={setForm} />
      <TagsField value={form.tags} onChange={(tags) => setForm({ ...form, tags })} />
    </EditorShell>
  );
}
