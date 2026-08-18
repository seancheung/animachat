"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { BookOpen, ChevronDown, FileText, Plus } from "lucide-react";
import Button from "@/components/ui/button";
import Popover from "@/components/ui/popover";
import SegmentedControl from "@/components/ui/segmented-control";
import { InteractiveStories } from "@/components/studio/InteractiveStories";
import { Manuscripts } from "@/components/studio/Manuscripts";

type StudioSection = "stories" | "manuscripts";

export function Studio() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const section: StudioSection = searchParams.get("type") === "manuscripts"
    ? "manuscripts"
    : "stories";

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-5 p-6">
        <header className="flex items-center gap-3">
          <SegmentedControl
            variant="secondary"
            className="min-w-0 flex-1 max-w-md"
            value={section}
            items={[
              { value: "stories", label: "Interactive stories" },
              { value: "manuscripts", label: "Manuscripts" },
            ]}
            onChange={(next) => router.replace(`/studio?type=${next}`, { scroll: false })}
          />
          <span className="flex-1" />
          <Popover
            side="bottom"
            align="end"
            className="w-64 p-1.5"
            content={({ close }) => (
              <div className="space-y-1">
                <button
                  type="button"
                  className="flex w-full cursor-pointer items-start gap-3 rounded-md px-3 py-2.5 text-left hover:bg-base-300/60"
                  onClick={() => { close(); router.push("/stories/new"); }}
                >
                  <BookOpen size={17} className="mt-0.5 shrink-0 text-primary-500" />
                  <span>
                    <span className="block font-medium text-content-100">Interactive story</span>
                    <span className="mt-0.5 block text-xs text-content-400">Scenes, branches, secrets, and playthroughs</span>
                  </span>
                </button>
                <button
                  type="button"
                  className="flex w-full cursor-pointer items-start gap-3 rounded-md px-3 py-2.5 text-left hover:bg-base-300/60"
                  onClick={() => { close(); router.push("/manuscripts/new"); }}
                >
                  <FileText size={17} className="mt-0.5 shrink-0 text-primary-500" />
                  <span>
                    <span className="block font-medium text-content-100">Manuscript</span>
                    <span className="mt-0.5 block text-xs text-content-400">Chapters, prose, and an AI assistant</span>
                  </span>
                </button>
              </div>
            )}
          >
            <Button><Plus /> New <ChevronDown size={14} /></Button>
          </Popover>
        </header>

        {section === "stories" ? <InteractiveStories /> : <Manuscripts />}
      </div>
    </div>
  );
}
