"use client";

import { useRef, useState } from "react";
import { Download, Eraser, Plus, Upload, X } from "lucide-react";
import { Field, Modal, Row } from "@/components/app";
import { confirmDialog } from "@/components/confirm";
import { ModelPicker, useProviders } from "@/components/ModelPicker";
import Badge from "@/components/ui/badge";
import Button from "@/components/ui/button";
import Input from "@/components/ui/input";
import InputNumber from "@/components/ui/input-number";
import InputPassword from "@/components/ui/input-password";
import Select from "@/components/ui/select";
import Slider from "@/components/ui/slider";
import Switch from "@/components/ui/switch";
import Textarea from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { useGet } from "@/lib/queries";
import { api, downloadBlob } from "@/lib/ui";
import { AI_TASKS, POV_LABELS, type Model, type Pov, type Provider, type Settings } from "@/lib/types";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Opacity slider with % readout; commits on release so dragging doesn't spam PUTs. */
function OpacitySlider({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [v, setV] = useState(value);
  const commit = () => v !== value && onCommit(v);
  return (
    <div className="flex items-center gap-2 h-8">
      <div className="flex-1 flex items-center">
        <Slider min={0.1} max={1} step={0.05} value={v} onChange={setV} onPointerUp={commit} onKeyUp={commit} />
      </div>
      <span className="text-sm text-content-300 w-9 text-right">{Math.round(v * 100)}%</span>
    </div>
  );
}

/** Typewriter speed in characters per second (dialogue-box layout only); 0 = off (text appears as it streams in). */
function TypingSpeedSlider({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [v, setV] = useState(value);
  const commit = () => v !== value && onCommit(v);
  return (
    <div className="flex items-center gap-2 h-8">
      <div className="flex-1 flex items-center">
        <Slider min={0} max={200} step={10} value={v} onChange={setV} onPointerUp={commit} onKeyUp={commit} />
      </div>
      <span className="text-sm text-content-300 w-16 text-right">{v === 0 ? "Off" : `${v} c/s`}</span>
    </div>
  );
}

const fmtBytes = (b: number) =>
  b >= 1048576
    ? `${(b / 1048576).toFixed(1)} MB`
    : b > 0
      ? `${Math.max(1, Math.round(b / 1024))} KB`
      : "0 KB";

const TASK_LABELS: Record<string, string> = {
  chat: "Chat generation",
  narrator: "Narrator",
  orchestrator: "Group-chat orchestration",
  director: "Story direction (playthroughs)",
  memory: "Summarization & memory",
  assist: "Co-writing assistant",
  impersonate: "Impersonate",
  title: "Title generation",
  novelize: "Novel rewrite (export)",
};

function ProviderCard({ provider, models, mutate }: { provider: Provider; models: Model[]; mutate: () => void }) {
  const [edit, setEdit] = useState<Partial<Provider> | null>(null);
  const [newModel, setNewModel] = useState<any | null>(null);
  const [editModel, setEditModel] = useState<any | null>(null);

  async function saveProvider() {
    await api.patch(`/api/providers/${provider.id}`, edit);
    setEdit(null);
    mutate();
  }
  async function addModel() {
    try {
      await api.post(`/api/providers/${provider.id}/models`, newModel);
      setNewModel(null);
      mutate();
    } catch (e: any) {
      toast.error(e.message);
    }
  }
  async function saveModel() {
    try {
      await api.patch(`/api/models/${editModel.id}`, editModel);
      setEditModel(null);
      mutate();
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  return (
    <div className="panel p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <span className="font-medium">{provider.name}</span>{" "}
          <Badge variant="secondary" rounded className="ml-2">
            {provider.type === "anthropic" ? "Anthropic" : "OpenAI-compatible"}
          </Badge>
          <div className="text-xs text-content-300 mt-1">{provider.baseUrl}</div>
        </div>
        <div className="flex gap-1">
          <Button variant="secondary" size="sm" onClick={() => setEdit({ ...provider })}>
            Edit
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={async () => {
              if (await confirmDialog({ title: "Delete provider", message: `Delete provider ${provider.name} and its models?`, confirmLabel: "Delete", danger: true })) {
                await api.del(`/api/providers/${provider.id}`);
                mutate();
              }
            }}
          >
            Delete
          </Button>
        </div>
      </div>
      <div className="space-y-1">
        {models.map((m) => (
          <div key={m.id} className="flex items-center justify-between bg-base-200 rounded-md px-3 py-1.5 text-sm">
            <div>
              {m.displayName}{" "}
              <span className="text-content-300 text-xs">
                ({m.modelId}, ctx {Math.round(m.contextWindow / 1000)}k
                {(m.inputPrice != null || m.outputPrice != null) && `, $${m.inputPrice ?? 0}/$${m.outputPrice ?? 0} per Mtok`})
              </span>
              {m.customBody && <Badge variant="secondary" rounded className="ml-2">custom body</Badge>}
            </div>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditModel({ ...m, customBody: m.customBody ? JSON.stringify(m.customBody) : "" })}
              >
                Edit
              </Button>
              <Button
                variant="ghost"
                size="sm"
                shape="square"
                onClick={async () => {
                  if (await confirmDialog({ title: "Delete model", message: `Delete model ${m.displayName}?`, confirmLabel: "Delete", danger: true })) {
                    await api.del(`/api/models/${m.id}`);
                    mutate();
                  }
                }}
              >
                <X />
              </Button>
            </div>
          </div>
        ))}
        <Button variant="secondary" size="sm" onClick={() => setNewModel({ modelId: "", displayName: "", contextWindow: 128000, inputPrice: null, cacheReadPrice: null, cacheWritePrice: null, outputPrice: null, customBody: "" })}>
          <Plus /> Add model
        </Button>
      </div>

      <Modal open={!!edit} onClose={() => setEdit(null)} title="Edit provider">
        {edit && (
          <div className="space-y-3">
            <Field label="Name"><Input className="w-full" value={edit.name ?? ""} onChange={(v) => setEdit({ ...edit, name: v })} /></Field>
            <Field label="Base URL"><Input className="w-full" value={edit.baseUrl ?? ""} onChange={(v) => setEdit({ ...edit, baseUrl: v })} /></Field>
            <Field label="API key"><InputPassword className="w-full" value={edit.apiKey ?? ""} onChange={(v) => setEdit({ ...edit, apiKey: v })} /></Field>
            <Button onClick={saveProvider}>Save</Button>
          </div>
        )}
      </Modal>

      {[
        { state: newModel, set: setNewModel, save: addModel, title: "Add model" },
        { state: editModel, set: setEditModel, save: saveModel, title: "Edit model" },
      ].map(({ state, set, save, title }) => (
        <Modal key={title} open={!!state} onClose={() => set(null)} title={title}>
          {state && (
            <div className="space-y-3">
              <Field label="Model ID" hint='as sent to the API, e.g. "claude-sonnet-5"'>
                <Input className="w-full" value={state.modelId} onChange={(v) => set({ ...state, modelId: v })} />
              </Field>
              <Field label="Display name">
                <Input className="w-full" value={state.displayName} onChange={(v) => set({ ...state, displayName: v })} />
              </Field>
              <Field label="Context window (tokens)" hint="the model's hard ceiling — used for context budgeting">
                <InputNumber className="w-full" integer value={state.contextWindow} onChange={(v) => set({ ...state, contextWindow: v })} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Input price ($/M tokens)" hint="optional — powers cost tracking">
                  <InputNumber
                    className="w-full"
                    min={0}
                    clearable
                    value={state.inputPrice ?? null}
                    onChange={(v) => set({ ...state, inputPrice: v })}
                    onClear={() => set({ ...state, inputPrice: null })}
                  />
                </Field>
                <Field label="Output price ($/M tokens)" hint="empty = cost not tracked">
                  <InputNumber
                    className="w-full"
                    min={0}
                    clearable
                    value={state.outputPrice ?? null}
                    onChange={(v) => set({ ...state, outputPrice: v })}
                    onClear={() => set({ ...state, outputPrice: null })}
                  />
                </Field>
                <Field label="Cache read ($/M tokens)" hint="usually discounted; empty = input price">
                  <InputNumber
                    className="w-full"
                    min={0}
                    clearable
                    value={state.cacheReadPrice ?? null}
                    onChange={(v) => set({ ...state, cacheReadPrice: v })}
                    onClear={() => set({ ...state, cacheReadPrice: null })}
                  />
                </Field>
                <Field label="Cache write ($/M tokens)" hint="often 1.25× input; empty = input price">
                  <InputNumber
                    className="w-full"
                    min={0}
                    clearable
                    value={state.cacheWritePrice ?? null}
                    onChange={(v) => set({ ...state, cacheWritePrice: v })}
                    onClear={() => set({ ...state, cacheWritePrice: null })}
                  />
                </Field>
              </div>
              <Field label="Custom request body (JSON)" hint='deep-merged into every request, e.g. {"thinking":{"type":"disabled"}}'>
                <Textarea
                  className="w-full font-mono text-xs h-24"
                  value={state.customBody ?? ""}
                  onChange={(v) => set({ ...state, customBody: v })}
                />
              </Field>
              <Button
                onClick={() => {
                  if (state.customBody?.trim()) {
                    try {
                      JSON.parse(state.customBody);
                    } catch {
                      toast.error("Custom body is not valid JSON");
                      return;
                    }
                  }
                  save();
                }}
              >
                Save
              </Button>
            </div>
          )}
        </Modal>
      ))}
    </div>
  );
}

function UsagePanel() {
  const [days, setDays] = useState(30);
  const { data } = useGet<any>(`/api/usage?days=${days}`);
  if (!data) return null;
  const fmt = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n ?? 0));
  const fmtCost = (n: number | null) => (n == null ? "—" : n > 0 && n < 0.01 ? "< $0.01" : `$${n.toFixed(2)}`);
  const anyPriced = data.totals.cost != null;
  return (
    <div className="space-y-3">
      <Row>
        <div className="text-sm text-content-300 flex items-center gap-2">
          Last
          <Select
            className="min-w-20"
            value={days}
            onChange={(v) => setDays(v)}
            options={[7, 30, 90, 365].map((d) => ({ value: d, label: String(d) }))}
          />
          days: <b className="text-content-100">{fmt(data.totals.input + data.totals.cached)}</b> in
          {data.totals.cached > 0 && <> ({fmt(data.totals.cached)} cached)</>} / <b className="text-content-100">{fmt(data.totals.output)}</b> out tokens · {data.totals.calls} calls
          {anyPriced && (
            <>
              {" "}· ≈ <b className="text-content-100">{fmtCost(data.totals.cost)}</b>
              {data.totals.unpriced > 0 && <span> ({fmt(data.totals.unpriced)} tokens from unpriced models)</span>}
            </>
          )}
        </div>
      </Row>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="panel p-3">
          <div className="text-xs uppercase tracking-wider text-content-300 mb-2">By feature</div>
          {data.byFeature.map((r: any) => (
            <div key={r.feature} className="flex justify-between text-sm py-0.5">
              <span>{TASK_LABELS[r.feature] ?? r.feature}</span>
              <span className="text-content-300">{fmt(r.input + r.cached)} / {fmt(r.output)}{anyPriced && <> · {fmtCost(r.cost)}</>}</span>
            </div>
          ))}
        </div>
        <div className="panel p-3">
          <div className="text-xs uppercase tracking-wider text-content-300 mb-2">By model</div>
          {data.byModel.map((r: any) => (
            <div key={r.provider + r.model} className="flex justify-between text-sm py-0.5">
              <span>{r.provider} · {r.model}</span>
              <span className="text-content-300">{fmt(r.input + r.cached)} / {fmt(r.output)}{anyPriced && <> · {fmtCost(r.cost)}</>}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { data: pm, refetch: mutate } = useProviders();
  const { data: settings, refetch: mutateSettings } = useGet<Settings>("/api/settings");
  const { data: storage, refetch: mutateStorage } = useGet<{ count: number; bytes: number }>("/api/assets");
  const [addingProvider, setAddingProvider] = useState<any | null>(null);
  const importSettingsRef = useRef<HTMLInputElement>(null);

  async function patchSettings(patch: Partial<Settings>) {
    await api.put("/api/settings", patch);
    mutateSettings();
  }

  if (!settings) return <div className="p-8 text-content-300">Loading…</div>;

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto p-6 space-y-8">
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-semibold">Providers & models</h1>
            <Button onClick={() => setAddingProvider({ name: "", type: "anthropic", baseUrl: "", apiKey: "" })}>
              <Plus /> Add provider
            </Button>
          </div>
          {pm?.providers.length === 0 && (
            <div className="text-sm text-content-300">Add a provider (Anthropic or any OpenAI-compatible API), then add models under it.</div>
          )}
          {pm?.providers.map((p) => (
            <ProviderCard key={p.id} provider={p} models={pm.models.filter((m) => m.providerId === p.id)} mutate={mutate} />
          ))}
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Models per task</h2>
          <div className="panel p-4 grid md:grid-cols-2 gap-3">
            <Field label="Global default model">
              <ModelPicker value={settings.defaultModelId} onChange={(v) => patchSettings({ defaultModelId: v })} placeholder="(none — required)" />
            </Field>
            {AI_TASKS.map((t) => (
              <Field key={t} label={TASK_LABELS[t]}>
                <ModelPicker
                  value={settings.taskModels[t] ?? null}
                  onChange={(v) => patchSettings({ taskModels: { ...settings.taskModels, [t]: v } })}
                  placeholder="(inherit default)"
                />
              </Field>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Roleplay</h2>
          <div className="panel p-4 grid md:grid-cols-2 gap-3">
            <Field label="AI language" hint="what characters & narrator write in">
              <Input className="w-full" value={settings.language} onChange={(v) => patchSettings({ language: v })} />
            </Field>
            <Field label="Point of view">
              <Select
                className="w-full"
                value={settings.pov}
                onChange={(v) => patchSettings({ pov: v as Pov })}
                options={Object.entries(POV_LABELS).map(([k, v]) => ({ value: k, label: v }))}
              />
            </Field>
            <Field label="User relationships" hint="track affinity between you (persona) and characters — off: no updates, no prompt injection">
              <Switch
                className="h-8"
                value={settings.userRelationshipsEnabled}
                onChange={(v) => patchSettings({ userRelationshipsEnabled: v })}
                label={settings.userRelationshipsEnabled ? "Enabled" : "Disabled"}
              />
            </Field>
            <Field label="Character relationships" hint="track affinity between characters in group chats — off: no updates, no prompt injection">
              <Switch
                className="h-8"
                value={settings.charRelationshipsEnabled}
                onChange={(v) => patchSettings({ charRelationshipsEnabled: v })}
                label={settings.charRelationshipsEnabled ? "Enabled" : "Disabled"}
              />
            </Field>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Interface</h2>
          <div className="panel p-4 grid md:grid-cols-2 gap-3">
            <Field label="Typing sound" hint="VN typing blips while a reply types out, in the dialogue-box layout">
              <Switch
                className="h-8"
                value={settings.typingSfxEnabled}
                onChange={(v) => patchSettings({ typingSfxEnabled: v })}
                label={settings.typingSfxEnabled ? "Enabled" : "Disabled"}
              />
            </Field>
            <Field label="Typing speed" hint="characters per second the reply types out at, in the dialogue-box layout; off = it appears as it streams in. The side panel always shows text as it arrives">
              <TypingSpeedSlider
                value={settings.typingSpeed}
                onCommit={(v) => patchSettings({ typingSpeed: v })}
              />
            </Field>
            <Field label="Chat panel blur" hint="backdrop blur behind the floating chat panel & the VN dialogue box">
              <Switch
                className="h-8"
                value={settings.chatPanelBlur}
                onChange={(v) => patchSettings({ chatPanelBlur: v })}
                label={settings.chatPanelBlur ? "Enabled" : "Disabled"}
              />
            </Field>
            <Field label="Chat panel opacity" hint="background opacity of the floating chat panel & the VN dialogue box">
              <OpacitySlider
                value={settings.chatPanelOpacity}
                onCommit={(v) => patchSettings({ chatPanelOpacity: v })}
              />
            </Field>
            <Field label="Scene & location styling" hint="let the active scene/location color the VN stage and chat panel (set per location/scene in the Library)">
              <Switch
                className="h-8"
                value={settings.stageStyleEnabled}
                onChange={(v) => patchSettings({ stageStyleEnabled: v })}
                label={settings.stageStyleEnabled ? "Enabled" : "Disabled"}
              />
            </Field>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Advanced: memory & context</h2>
          <div className="panel p-4 grid md:grid-cols-4 gap-3">
            <Field label="Context budget cap" hint="max prompt tokens per request">
              <InputNumber className="w-full" integer value={settings.contextBudgetCap} onChange={(v) => patchSettings({ contextBudgetCap: v || 32000 })} />
            </Field>
            <Field label="Verbatim share" hint="fraction kept as raw messages">
              <InputNumber className="w-full" value={settings.verbatimShare} onChange={(v) => patchSettings({ verbatimShare: v || 0.35 })} />
            </Field>
            <Field label="Chunk threshold" hint="tokens before a summarization pass">
              <InputNumber className="w-full" integer value={settings.chunkThreshold} onChange={(v) => patchSettings({ chunkThreshold: v || 3000 })} />
            </Field>
            <Field label="Output reserve" hint="tokens reserved for the reply">
              <InputNumber className="w-full" integer value={settings.outputReserve} onChange={(v) => patchSettings({ outputReserve: v || 2000 })} />
            </Field>
            <Field label="Co-writer JSON fixups" hint="retries feeding a field-data parse error back to the assistant; 0 = off">
              <InputNumber className="w-full" integer value={settings.assistFixupRetries} onChange={(v) => patchSettings({ assistFixupRetries: Math.max(0, v ?? 1) })} />
            </Field>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Token usage & cost</h2>
          <UsagePanel />
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Storage</h2>
          <div className="panel p-4 flex items-center gap-4 flex-wrap">
            <div className="text-sm text-content-300">
              Uploaded assets:{" "}
              <b className="text-content-100">{storage?.count ?? "…"}</b> file
              {storage?.count === 1 ? "" : "s"} ·{" "}
              <b className="text-content-100">{storage ? fmtBytes(storage.bytes) : "…"}</b>
            </div>
            <span className="flex-1" />
            <Button
              variant="secondary"
              onClick={async () => {
                const { count, bytes } = await api.get("/api/assets/prune");
                if (!count) return toast.success("No unused assets found");
                if (
                  !(await confirmDialog({
                    title: "Prune unused assets",
                    message: `Delete ${count} uploaded file${count === 1 ? "" : "s"} (${fmtBytes(bytes)}) that no character, location or scene references? Files uploaded in an editor you haven't saved yet also count as unused.`,
                    confirmLabel: "Prune",
                    danger: true,
                  }))
                )
                  return;
                const res = await api.post("/api/assets/prune");
                toast.success(`Removed ${res.removed} file${res.removed === 1 ? "" : "s"}, freed ${fmtBytes(res.bytes)}`);
                mutateStorage();
              }}
            >
              <Eraser /> Prune unused assets
            </Button>
          </div>
        </section>

        <section className="space-y-3 pb-10">
          <h2 className="text-lg font-semibold">Settings transfer</h2>
          <Row>
            <Button
              variant="secondary"
              onClick={async () => {
                const res = await fetch("/api/settings/export");
                await downloadBlob(res, "animachat-settings.json");
              }}
            >
              <Download /> Export settings
            </Button>
            <Button variant="secondary" onClick={() => importSettingsRef.current?.click()}>
              <Upload /> Import settings…
            </Button>
            <input
              ref={importSettingsRef}
              type="file"
              hidden
              accept=".json,application/json"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                let parsed;
                try {
                  parsed = JSON.parse(await f.text());
                } catch {
                  return void toast.error("Not a valid JSON file");
                }
                if (
                  !(await confirmDialog({
                    title: "Import settings",
                    message:
                      "This overwrites global settings (default & per-task models, roleplay and interface preferences) and updates providers & models — including API keys — from the file. Library content and chats are untouched. Continue?",
                    confirmLabel: "Import",
                    danger: true,
                  }))
                )
                  return;
                try {
                  const res = await api.post("/api/settings/import", parsed);
                  toast.success(
                    `Imported ${res.providers} provider${res.providers === 1 ? "" : "s"}, ${res.models} model${res.models === 1 ? "" : "s"}` +
                      (res.skippedModels ? ` (${res.skippedModels} skipped)` : "")
                  );
                  location.reload();
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Import failed");
                }
              }}
            />
          </Row>
        </section>
      </div>

      <Modal open={!!addingProvider} onClose={() => setAddingProvider(null)} title="Add provider">
        {addingProvider && (
          <div className="space-y-3">
            <Field label="Name"><Input className="w-full" placeholder="Anthropic / OpenRouter / Groq…" value={addingProvider.name} onChange={(v) => setAddingProvider({ ...addingProvider, name: v })} /></Field>
            <Field label="Type">
              <Select
                className="w-full"
                value={addingProvider.type}
                onChange={(v) => setAddingProvider({ ...addingProvider, type: v })}
                options={[
                  { value: "anthropic", label: "Anthropic" },
                  { value: "openai", label: "OpenAI-compatible" },
                ]}
              />
            </Field>
            <Field label="Base URL" hint="leave empty for the official endpoint">
              <Input className="w-full" placeholder={addingProvider.type === "anthropic" ? "https://api.anthropic.com" : "https://api.openai.com/v1"} value={addingProvider.baseUrl} onChange={(v) => setAddingProvider({ ...addingProvider, baseUrl: v })} />
            </Field>
            <Field label="API key"><InputPassword className="w-full" value={addingProvider.apiKey} onChange={(v) => setAddingProvider({ ...addingProvider, apiKey: v })} /></Field>
            <Button
              onClick={async () => {
                try {
                  await api.post("/api/providers", addingProvider);
                  setAddingProvider(null);
                  mutate();
                } catch (e: any) {
                  toast.error(e.message);
                }
              }}
            >
              Add
            </Button>
          </div>
        )}
      </Modal>
    </div>
  );
}
