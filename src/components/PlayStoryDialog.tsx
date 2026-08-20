"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  BookOpen,
  Captions,
  ChevronRight,
  PanelRight,
  Play,
  ScrollText,
  UserRound,
  VenetianMask,
} from "lucide-react";
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

/** The play settings shared by direct Story-card Play and the Chats two-step flow. */
function PlayStorySettings({
  storyId,
  open,
  onBack,
}: {
  storyId: string;
  open: boolean;
  onBack?: () => void;
}) {
  const router = useRouter();
  const invalidate = useInvalidate();
  const { data: story } = useGet<Story>(`/api/stories/${storyId}`, { enabled: open });
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
    <div className="space-y-4">
      {onBack && (
        <div className="text-xs font-medium uppercase tracking-wider text-content-400">
          Step 2 of 2 · Play settings
        </div>
      )}
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
            ...cast.map((character) => ({ value: `char:${character.id}`, label: character.name })),
            ...personaSearch.options.map((option) => ({
              value: `persona:${option.value}`,
              label: option.label,
            })),
          ]}
          loading={personaSearch.loading}
          hasMore={personaSearch.hasMore}
          isFetchingMore={personaSearch.isFetchingMore}
          onLoadMore={personaSearch.onLoadMore}
          onSearch={personaSearch.onSearch}
          renderOption={(option) => (
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <span className="shrink-0 text-content-300">
                {String(option.value).startsWith("char:") ? (
                  <UserRound size={13} />
                ) : (
                  <VenetianMask size={13} />
                )}
              </span>
              <span className="truncate">{option.label}</span>
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
            options={scenes.map((scene, index) => ({
              value: scene.id,
              label: `${index + 1}. ${scene.name}`,
            }))}
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
          <Input
            className="w-full"
            placeholder="(global default)"
            value={language}
            onChange={setLanguage}
          />
        </Field>
        <Field label="POV override">
          <Select
            className="w-full"
            value={pov || null}
            onChange={(value) => setPov(value ?? "")}
            options={Object.entries(POV_LABELS).map(([value, label]) => ({ value, label }))}
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
              {
                value: "panel",
                label: (
                  <span className="inline-flex items-center gap-1.5">
                    <PanelRight size={13} /> Side panel
                  </span>
                ),
              },
              {
                value: "dialogue",
                label: (
                  <span className="inline-flex items-center gap-1.5">
                    <Captions size={13} /> Dialogue box
                  </span>
                ),
              },
            ]}
          />
        </Field>
      </div>
      <div className="flex items-center gap-2">
        {onBack && (
          <Button variant="secondary" disabled={busy} onClick={onBack}>
            <ArrowLeft /> Back
          </Button>
        )}
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
            } catch (error) {
              toast.error(error instanceof Error ? error.message : String(error));
              setBusy(false);
            }
          }}
        >
          <Play /> {busy ? "Starting…" : "Start playthrough"}
        </Button>
      </div>
    </div>
  );
}

/** Direct Play from a story card: the story is already known, so settings open immediately. */
export function PlayStoryDialog({
  storyId,
  open,
  onClose,
}: {
  storyId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const { data: story } = useGet<Story>(`/api/stories/${storyId}`, {
    enabled: open && !!storyId,
  });

  return (
    <Modal open={open} onClose={onClose} title={story ? `Play "${story.name}"` : "Play"}>
      {storyId && (
        <PlayStorySettings key={storyId} storyId={storyId} open={open} />
      )}
    </Modal>
  );
}

/** Chats → Playthrough: choose a story first, then configure the existing play settings. */
export function NewPlaythroughDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [step, setStep] = useState<"story" | "settings">("story");
  const [selectedStory, setSelectedStory] = useState<{ id: string; name: string } | null>(null);
  const storySearch = useComboboxSearch("/api/stories", {
    enabled: open && step === "story",
    selected: selectedStory
      ? { value: selectedStory.id, label: selectedStory.name }
      : null,
  });
  const { data: story } = useGet<Story>(`/api/stories/${selectedStory?.id}`, {
    enabled: open && step === "settings" && !!selectedStory,
  });

  const close = () => {
    setStep("story");
    setSelectedStory(null);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title={step === "story" ? "New playthrough" : story ? `Play "${story.name}"` : "Play settings"}
    >
      {step === "story" ? (
        <div className="space-y-4">
          <div className="text-xs font-medium uppercase tracking-wider text-content-400">
            Step 1 of 2 · Choose a story
          </div>
          <Field
            label="Story"
            hint="Choose the interactive story whose cast, scenes, and lore will be snapshotted into this playthrough."
          >
            <Combobox
              className="w-full"
              value={selectedStory?.id ?? null}
              onChange={(id) => {
                const option = storySearch.options.find((item) => item.value === id);
                if (option) setSelectedStory({ id, name: option.label });
              }}
              options={storySearch.options}
              loading={storySearch.loading}
              hasMore={storySearch.hasMore}
              isFetchingMore={storySearch.isFetchingMore}
              onLoadMore={storySearch.onLoadMore}
              onSearch={storySearch.onSearch}
              renderOption={(option) => (
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <BookOpen size={13} className="shrink-0 text-content-300" />
                  <span className="truncate">{option.label}</span>
                </span>
              )}
              placeholder="Search stories…"
              emptyMessage="No stories match"
            />
          </Field>
          <Button disabled={!selectedStory} onClick={() => setStep("settings")}>
            Continue <ChevronRight />
          </Button>
        </div>
      ) : selectedStory ? (
        <PlayStorySettings
          key={selectedStory.id}
          storyId={selectedStory.id}
          open={open}
          onBack={() => setStep("story")}
        />
      ) : null}
    </Modal>
  );
}
