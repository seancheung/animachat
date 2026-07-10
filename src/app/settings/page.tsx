"use client";

import { useRef, useState } from "react";
import useSWR from "swr";
import { Field, Modal, Row } from "@/components/ui";
import { ModelPicker, useProviders } from "@/components/ModelPicker";
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
      alert(e.message);
    }
  }
  async function saveModel() {
    try {
      await api.patch(`/api/models/${editModel.id}`, editModel);
      setEditModel(null);
      mutate();
    } catch (e: any) {
      alert(e.message);
    }
  }

  return (
    <div className="panel p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <span className="font-medium">{provider.name}</span>{" "}
          <span className="chip ml-2">{provider.type === "anthropic" ? "Anthropic" : "OpenAI-compatible"}</span>
          <div className="text-xs text-[var(--text-dim)] mt-1">{provider.baseUrl}</div>
        </div>
        <div className="flex gap-1">
          <button className="btn btn-sm" onClick={() => setEdit({ ...provider })}>
            Edit
          </button>
          <button
            className="btn btn-sm btn-danger"
            onClick={async () => {
              if (confirm(`Delete provider ${provider.name} and its models?`)) {
                await api.del(`/api/providers/${provider.id}`);
                mutate();
              }
            }}
          >
            Delete
          </button>
        </div>
      </div>
      <div className="space-y-1">
        {models.map((m) => (
          <div key={m.id} className="flex items-center justify-between bg-[var(--bg-soft)] rounded-lg px-3 py-1.5 text-sm">
            <div>
              {m.displayName} <span className="text-[var(--text-dim)] text-xs">({m.modelId}, ctx {Math.round(m.contextWindow / 1000)}k)</span>
              {m.customBody && <span className="chip ml-2">custom body</span>}
            </div>
            <div className="flex gap-1">
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => setEditModel({ ...m, customBody: m.customBody ? JSON.stringify(m.customBody) : "" })}
              >
                Edit
              </button>
              <button
                className="btn btn-sm btn-ghost"
                onClick={async () => {
                  if (confirm(`Delete model ${m.displayName}?`)) {
                    await api.del(`/api/models/${m.id}`);
                    mutate();
                  }
                }}
              >
                ✕
              </button>
            </div>
          </div>
        ))}
        <button className="btn btn-sm" onClick={() => setNewModel({ modelId: "", displayName: "", contextWindow: 128000, customBody: "" })}>
          + Add model
        </button>
      </div>

      <Modal open={!!edit} onClose={() => setEdit(null)} title="Edit provider">
        {edit && (
          <div className="space-y-3">
            <Field label="Name"><input className="input" value={edit.name ?? ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Base URL"><input className="input" value={edit.baseUrl ?? ""} onChange={(e) => setEdit({ ...edit, baseUrl: e.target.value })} /></Field>
            <Field label="API key"><input className="input" type="password" value={edit.apiKey ?? ""} onChange={(e) => setEdit({ ...edit, apiKey: e.target.value })} /></Field>
            <button className="btn btn-primary" onClick={saveProvider}>Save</button>
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
                <input className="input" value={state.modelId} onChange={(e) => set({ ...state, modelId: e.target.value })} />
              </Field>
              <Field label="Display name">
                <input className="input" value={state.displayName} onChange={(e) => set({ ...state, displayName: e.target.value })} />
              </Field>
              <Field label="Context window (tokens)" hint="the model's hard ceiling — used for context budgeting">
                <input className="input" type="number" value={state.contextWindow} onChange={(e) => set({ ...state, contextWindow: Number(e.target.value) })} />
              </Field>
              <Field label="Custom request body (JSON)" hint='deep-merged into every request, e.g. {"thinking":{"type":"disabled"}}'>
                <textarea
                  className="input font-mono text-xs h-24"
                  value={state.customBody ?? ""}
                  onChange={(e) => set({ ...state, customBody: e.target.value })}
                />
              </Field>
              <button
                className="btn btn-primary"
                onClick={() => {
                  if (state.customBody?.trim()) {
                    try {
                      JSON.parse(state.customBody);
                    } catch {
                      alert("Custom body is not valid JSON");
                      return;
                    }
                  }
                  save();
                }}
              >
                Save
              </button>
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
        <div className="text-sm text-[var(--text-dim)]">
          Last
          <select className="input inline-block w-auto mx-2" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {[7, 30, 90, 365].map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          days: <b className="text-[var(--text)]">{fmt(data.totals.input)}</b> in / <b className="text-[var(--text)]">{fmt(data.totals.output)}</b> out tokens · {data.totals.calls} calls
        </div>
      </Row>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="panel p-3">
          <div className="text-xs uppercase tracking-wider text-[var(--text-dim)] mb-2">By feature</div>
          {data.byFeature.map((r: any) => (
            <div key={r.feature} className="flex justify-between text-sm py-0.5">
              <span>{TASK_LABELS[r.feature] ?? r.feature}</span>
              <span className="text-[var(--text-dim)]">{fmt(r.input)} / {fmt(r.output)}</span>
            </div>
          ))}
        </div>
        <div className="panel p-3">
          <div className="text-xs uppercase tracking-wider text-[var(--text-dim)] mb-2">By model</div>
          {data.byModel.map((r: any) => (
            <div key={r.provider + r.model} className="flex justify-between text-sm py-0.5">
              <span>{r.provider} · {r.model}</span>
              <span className="text-[var(--text-dim)]">{fmt(r.input)} / {fmt(r.output)}</span>
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

  if (!settings) return <div className="p-8 text-[var(--text-dim)]">Loading…</div>;

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto p-6 space-y-8">
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-semibold">Providers & models</h1>
            <button className="btn btn-primary btn-sm" onClick={() => setAddingProvider({ name: "", type: "anthropic", baseUrl: "", apiKey: "" })}>
              + Add provider
            </button>
          </div>
          {pm?.providers.length === 0 && (
            <div className="text-sm text-[var(--text-dim)]">Add a provider (Anthropic or any OpenAI-compatible API), then add models under it.</div>
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
              <input className="input" value={settings.language} onChange={(e) => patchSettings({ language: e.target.value })} />
            </Field>
            <Field label="Point of view">
              <select className="input" value={settings.pov} onChange={(e) => patchSettings({ pov: e.target.value as Pov })}>
                {Object.entries(POV_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Typing sound">
              <select className="input" value={settings.typingSfxEnabled ? "on" : "off"} onChange={(e) => patchSettings({ typingSfxEnabled: e.target.value === "on" })}>
                <option value="on">Enabled</option>
                <option value="off">Disabled</option>
              </select>
            </Field>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Advanced: memory & context</h2>
          <div className="panel p-4 grid md:grid-cols-4 gap-3">
            <Field label="Context budget cap" hint="max prompt tokens per request">
              <input className="input" type="number" value={settings.contextBudgetCap} onChange={(e) => patchSettings({ contextBudgetCap: Number(e.target.value) || 32000 })} />
            </Field>
            <Field label="Verbatim share" hint="fraction kept as raw messages">
              <input className="input" type="number" step="0.05" min="0.1" max="0.9" value={settings.verbatimShare} onChange={(e) => patchSettings({ verbatimShare: Number(e.target.value) || 0.35 })} />
            </Field>
            <Field label="Chunk threshold" hint="tokens before a summarization pass">
              <input className="input" type="number" value={settings.chunkThreshold} onChange={(e) => patchSettings({ chunkThreshold: Number(e.target.value) || 3000 })} />
            </Field>
            <Field label="Output reserve" hint="tokens reserved for the reply">
              <input className="input" type="number" value={settings.outputReserve} onChange={(e) => patchSettings({ outputReserve: Number(e.target.value) || 2000 })} />
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
            <button
              className="btn"
              onClick={async () => {
                const res = await fetch("/api/backup");
                await downloadBlob(res, "animachat-backup.zip");
              }}
            >
              ⬇ Download full backup
            </button>
            <button className="btn btn-danger" onClick={() => restoreRef.current?.click()}>
              ⬆ Restore from backup…
            </button>
            <input
              ref={restoreRef}
              type="file"
              hidden
              accept=".zip"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f || !confirm("Restoring REPLACES the current database and assets. Continue?")) return;
                const fd = new FormData();
                fd.append("file", f);
                const res = await fetch("/api/restore", { method: "POST", body: fd });
                if (res.ok) {
                  alert("Restored.");
                  location.reload();
                } else alert((await res.json())?.error ?? "Restore failed");
              }}
            />
          </Row>
        </section>
      </div>

      <Modal open={!!addingProvider} onClose={() => setAddingProvider(null)} title="Add provider">
        {addingProvider && (
          <div className="space-y-3">
            <Field label="Name"><input className="input" placeholder="Anthropic / OpenRouter / Groq…" value={addingProvider.name} onChange={(e) => setAddingProvider({ ...addingProvider, name: e.target.value })} /></Field>
            <Field label="Type">
              <select className="input" value={addingProvider.type} onChange={(e) => setAddingProvider({ ...addingProvider, type: e.target.value })}>
                <option value="anthropic">Anthropic</option>
                <option value="openai">OpenAI-compatible</option>
              </select>
            </Field>
            <Field label="Base URL" hint="leave empty for the official endpoint">
              <input className="input" placeholder={addingProvider.type === "anthropic" ? "https://api.anthropic.com" : "https://api.openai.com/v1"} value={addingProvider.baseUrl} onChange={(e) => setAddingProvider({ ...addingProvider, baseUrl: e.target.value })} />
            </Field>
            <Field label="API key"><input className="input" type="password" value={addingProvider.apiKey} onChange={(e) => setAddingProvider({ ...addingProvider, apiKey: e.target.value })} /></Field>
            <button
              className="btn btn-primary"
              onClick={async () => {
                try {
                  await api.post("/api/providers", addingProvider);
                  setAddingProvider(null);
                  mutate();
                } catch (e: any) {
                  alert(e.message);
                }
              }}
            >
              Add
            </button>
          </div>
        )}
      </Modal>
    </div>
  );
}
