"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Captions, PanelRight, Play, ScrollText, UserRound, VenetianMask } from "lucide-react";
import { ModelPicker } from "@/components/ModelPicker";
import { Field, Modal } from "@/components/app";
import Button from "@/components/ui/button";
import Combobox from "@/components/ui/combobox";
import Input from "@/components/ui/input";
import SegmentedControl from "@/components/ui/segmented-control";
import Select from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { useComboboxSearch, useGet, useInvalidate } from "@/lib/queries";
import { api } from "@/lib/ui";
import { POV_LABELS, type Story } from "@/lib/types";

/**
 * Starts a playthrough of a story: play-as (cast member / persona / spectator),
 * optional starting scene, and the cost/presentation knobs. Everything else the
 * playthrough needs comes from the story document, snapshotted at creation.
 */
export function PlayStoryDialog({
  storyId,
  open,
  onClose,
}: {
  storyId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const invalidate = useInvalidate();
  const { data: story } = useGet<Story>(`/api/stories/${storyId}`, { enabled: open && !!storyId });
  const [playAs, setPlayAs] = useState<string | null>(null); // "char:<id>" | "persona:<id>"
  const [sceneId, setSceneId] = useState<string | null>(null);
  const [modelId, setModelId] = useState<string | null>(null);
  const [language, setLanguage] = useState("");
  const [pov, setPov] = useState<string>("");
  const [layout, setLayout] = useState<"panel" | "dialogue">("panel");
  const [busy, setBusy] = useState(false);
  const personaSearch = useComboboxSearch("/api/personas", { enabled: open });

  const cast = story?.characters ?? [];
  const scenes = story?.scenes ?? [];
  const playedCharacterId = playAs?.startsWith("char:") ? playAs.slice(5) : null;

  return (
    <Modal open={open} onClose={onClose} title={story ? `Play "${story.name}"` : "Play"}>
      <div className="space-y-4">
        <div className="text-xs text-content-400 flex items-center gap-1.5">
          <ScrollText size={12} className="shrink-0" />
          The narrator directs playthroughs — the story is snapshotted at creation, so later edits
          never touch a running playthrough.
        </div>
        <Field label="Play as" hint="a cast member, or one of your personas">
          <Combobox
            className="w-full"
            value={playAs}
            onChange={setPlayAs}
            options={[
              // the authored cast is small and always fully listed; personas search server-side
              ...cast.map((c) => ({ value: `char:${c.id}`, label: c.name })),
              ...personaSearch.options.map((o) => ({ value: `persona:${o.value}`, label: o.label })),
            ]}
            loading={personaSearch.loading}
            hasMore={personaSearch.hasMore}
            isFetchingMore={personaSearch.isFetchingMore}
            onLoadMore={personaSearch.onLoadMore}
            onSearch={personaSearch.onSearch}
            renderOption={(o) => (
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <span className="shrink-0 text-content-300">
                  {String(o.value).startsWith("char:") ? <UserRound size={13} /> : <VenetianMask size={13} />}
                </span>
                <span className="truncate">{o.label}</span>
              </span>
            )}
            placeholder="(spectator)"
            clearable
            onClear={() => setPlayAs(null)}
          />
        </Field>
        {scenes.length > 0 && (
          <Field
            label="Starting scene"
            hint={playedCharacterId ? "playing a cast member, play opens at their entrance" : undefined}
          >
            <Select
              className="w-full"
              value={sceneId}
              onChange={setSceneId}
              options={scenes.map((s, i) => ({ value: s.id, label: `${i + 1}. ${s.name}` }))}
              placeholder={`1. ${scenes[0]?.name} (first)`}
              clearable
              onClear={() => setSceneId(null)}
            />
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Model" hint="the one setting that stays editable later">
            <ModelPicker value={modelId} onChange={setModelId} />
          </Field>
          <Field label="Language override">
            <Input className="w-full" placeholder="(global default)" value={language} onChange={setLanguage} />
          </Field>
          <Field label="POV override">
            <Select
              className="w-full"
              value={pov || null}
              onChange={(v) => setPov(v ?? "")}
              options={Object.entries(POV_LABELS).map(([k, v]) => ({ value: k, label: v }))}
              placeholder="(global default)"
              clearable
              onClear={() => setPov("")}
            />
          </Field>
          <Field label="Chat layout" hint="switchable anytime">
            <SegmentedControl
              className="w-full"
              size="sm"
              value={layout}
              onChange={setLayout}
              items={[
                { value: "panel", label: (<span className="inline-flex items-center gap-1.5"><PanelRight size={13} /> Side panel</span>) },
                { value: "dialogue", label: (<span className="inline-flex items-center gap-1.5"><Captions size={13} /> Dialogue box</span>) },
              ]}
            />
          </Field>
        </div>
        <Button
          disabled={busy || !story}
          onClick={async () => {
            setBusy(true);
            try {
              const chat = await api.post("/api/chats", {
                mode: "story",
                storyId,
                personaCharacterId: playedCharacterId,
                personaId: playAs?.startsWith("persona:") ? playAs.slice(8) : null,
                sceneId,
                modelId,
                language,
                pov,
                overrides: layout === "dialogue" ? { layout: "dialogue" } : {},
              });
              void invalidate("/api/chats");
              router.push(`/chat/${chat.id}`);
            } catch (e) {
              toast.error(e instanceof Error ? e.message : String(e));
              setBusy(false);
            }
          }}
        >
          <Play /> {busy ? "Starting…" : "Start playthrough"}
        </Button>
      </div>
    </Modal>
  );
}
