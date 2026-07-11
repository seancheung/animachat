"use client";

import { useRef, useState } from "react";
import useSWR from "swr";
import { Download, Plus, Upload, X } from "lucide-react";
import { Field, Modal, Row } from "@/components/app";
import { confirmDialog } from "@/components/confirm";
import { ModelPicker, useProviders } from "@/components/ModelPicker";
import Badge from "@/components/ui/badge";
import Button from "@/components/ui/button";
import Input from "@/components/ui/input";
import InputNumber from "@/components/ui/input-number";
import InputPassword from "@/components/ui/input-password";
import Select from "@/components/ui/select";
import Switch from "@/components/ui/switch";
import Textarea from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { api, downloadBlob } from "@/lib/ui";
import { AI_TASKS, POV_LABELS, type Model, type Pov, type Provider, type Settings } from "@/lib/types";

/* eslint-disable @typescript-eslint/no-explicit-any */

const TASK_LABELS: Record<string, string> = {
  chat: "Chat generation",
  narrator: "Narrator",
  orchestrator: "Group-chat orchestration",
  memory: "Summarization & memory",
  assist: "Co-writing assistant",
  impersonate: "Impersonate",
  title: "Title generation",
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
              {m.displayName} <span className="text-content-300 text-xs">({m.modelId}, ctx {Math.round(m.contextWindow / 1000)}k)</span>
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
        <Button variant="secondary" size="sm" onClick={() => setNewModel({ modelId: "", displayName: "", contextWindow: 128000, customBody: "" })}>
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
  const { data } = useSWR<any>(`/api/usage?days=${days}`, api.get);
  if (!data) return null;
  const fmt = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n ?? 0));
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
          days: <b className="text-content-100">{fmt(data.totals.input)}</b> in / <b className="text-content-100">{fmt(data.totals.output)}</b> out tokens · {data.totals.calls} calls
        </div>
      </Row>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="panel p-3">
          <div className="text-xs uppercase tracking-wider text-content-300 mb-2">By feature</div>
          {data.byFeature.map((r: any) => (
            <div key={r.feature} className="flex justify-between text-sm py-0.5">
              <span>{TASK_LABELS[r.feature] ?? r.feature}</span>
              <span className="text-content-300">{fmt(r.input)} / {fmt(r.output)}</span>
            </div>
          ))}
        </div>
        <div className="panel p-3">
          <div className="text-xs uppercase tracking-wider text-content-300 mb-2">By model</div>
          {data.byModel.map((r: any) => (
            <div key={r.provider + r.model} className="flex justify-between text-sm py-0.5">
              <span>{r.provider} · {r.model}</span>
              <span className="text-content-300">{fmt(r.input)} / {fmt(r.output)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { data: pm, mutate } = useProviders();
  const { data: settings, mutate: mutateSettings } = useSWR<Settings>("/api/settings", api.get);
  const [addingProvider, setAddingProvider] = useState<any | null>(null);
  const restoreRef = useRef<HTMLInputElement>(null);

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
            <Button size="sm" onClick={() => setAddingProvider({ name: "", type: "anthropic", baseUrl: "", apiKey: "" })}>
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
          <h2 className="text-lg font-semibold">Defaults</h2>
          <div className="panel p-4 grid md:grid-cols-3 gap-3">
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
            <Field label="Typing sound">
              <Switch
                className="h-8"
                value={settings.typingSfxEnabled}
                onChange={(v) => patchSettings({ typingSfxEnabled: v })}
                label={settings.typingSfxEnabled ? "Enabled" : "Disabled"}
              />
            </Field>
            <Field label="Chat panel blur" hint="backdrop blur behind the floating chat panel">
              <Switch
                className="h-8"
                value={settings.chatPanelBlur}
                onChange={(v) => patchSettings({ chatPanelBlur: v })}
                label={settings.chatPanelBlur ? "Enabled" : "Disabled"}
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
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Token usage</h2>
          <UsagePanel />
        </section>

        <section className="space-y-3 pb-10">
          <h2 className="text-lg font-semibold">Backup</h2>
          <Row>
            <Button
              variant="secondary"
              onClick={async () => {
                const res = await fetch("/api/backup");
                await downloadBlob(res, "animachat-backup.zip");
              }}
            >
              <Download /> Download full backup
            </Button>
            <Button variant="danger" onClick={() => restoreRef.current?.click()}>
              <Upload /> Restore from backup…
            </Button>
            <input
              ref={restoreRef}
              type="file"
              hidden
              accept=".zip"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                if (!(await confirmDialog({ title: "Restore backup", message: "Restoring REPLACES the current database and assets. Continue?", confirmLabel: "Restore", danger: true }))) return;
                const fd = new FormData();
                fd.append("file", f);
                const res = await fetch("/api/restore", { method: "POST", body: fd });
                if (res.ok) {
                  toast.success("Restored.");
                  location.reload();
                } else toast.error((await res.json())?.error ?? "Restore failed");
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
