"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, BookOpen, Download, Play, Trash2 } from "lucide-react";
import { PlayStoryDialog } from "@/components/PlayStoryDialog";
import { EmptyState } from "@/components/app";
import { confirmDialog } from "@/components/confirm";
import Badge from "@/components/ui/badge";
import Button from "@/components/ui/button";
import LoadMoreSentinel from "@/components/ui/load-more";
import { toast } from "@/components/ui/toast";
import { useInvalidate, usePagedList } from "@/lib/queries";
import { api, assetUrl } from "@/lib/ui";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Library's Stories tab: self-contained works edited on their own pages.
 * Running and completed playthroughs live with the other conversations on
 * the Chats page.
 */
export function InteractiveStories({
  query,
  sort,
  tag,
  onExport,
}: {
  query: string;
  sort: "updated" | "created" | "name";
  tag: string;
  onExport: (id: string) => void;
}) {
  const router = useRouter();
  const invalidate = useInvalidate();
  const [playStoryId, setPlayStoryId] = useState<string | null>(null);
  const [adaptingId, setAdaptingId] = useState<string | null>(null);

  const stories = usePagedList<any>("/api/stories", {
    q: query || undefined,
    tag: tag || undefined,
    sort,
  });
  const filtered = !!(query || tag);
  const refresh = () => invalidate("/api/stories", "/api/library/tags", "/api/library/search");

  async function deleteStory(item: any) {
    if (
      !(await confirmDialog({
        title: "Delete story",
        message: `Delete "${item.name}"? Its embedded cast, scenes, locations and lorebooks go with it. Existing playthroughs are untouched (they run on their own snapshots).`,
        confirmLabel: "Delete",
        danger: true,
      }))
    )
      return;
    try {
      await api.del(`/api/stories/${item.id}`);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  async function adaptToManuscript(item: any) {
    if (!(await confirmDialog({
      title: "Create manuscript adaptation?",
      message: "This creates an independent manuscript scaffold with the story's synopsis, embedded characters, and one empty chapter per scene. The original interactive story will not change.",
      confirmLabel: "Create manuscript",
    }))) return;
    setAdaptingId(item.id);
    try {
      const result = await api.post<{ id: string }>("/api/library/adapt", { sourceType: "story", id: item.id });
      toast.success("Manuscript adaptation created");
      router.push(`/manuscripts/${result.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setAdaptingId(null);
    }
  }

  return (
    <>
      <div className="space-y-4">
        {!stories.isLoading && stories.items.length === 0 && !filtered && (
          <EmptyState>
            No stories yet — a story is a self-contained work: its cast, scenes, places and lore
            live inside it. Create one and the AI co-writer can build the whole thing with you
            (or extract it from an attached novel).
          </EmptyState>
        )}
        {!stories.isLoading && stories.items.length === 0 && filtered && (
          <EmptyState>
            No stories match {query ? `“${query}”` : `the tag “${tag}”`}.
          </EmptyState>
        )}

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {stories.items.map((item) => (
            <div
              key={item.id}
              className="panel overflow-hidden cursor-pointer hover:border-primary-500 transition-colors"
              onClick={() => router.push(`/stories/${item.id}`)}
            >
              <div className="w-full aspect-video flex items-center justify-center text-content-300 bg-base-300 overflow-hidden">
                {item.coverAsset ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={assetUrl(item.coverAsset)!} alt="" className="w-full h-full object-cover object-top" />
                ) : (
                  <BookOpen size={32} />
                )}
              </div>
              <div className="p-2.5">
                <div className="font-medium text-sm truncate">{item.name}</div>
                {/* sliced far past what two clamped lines can show — line-clamp's
                    ellipsis still appears, while huge premises stay out of the DOM.
                    h-[2lh]: a box taller than the clamped 2 lines (h-8 is, with this
                    theme's --spacing) lets the 3rd line paint below the ellipsis */}
                <div className="text-xs text-content-300 line-clamp-2 h-[2lh]">
                  {item.castCount} cast, {item.sceneCount} scenes — {(item.description ?? "").slice(0, 300)}
                </div>
                {item.tags?.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {item.tags.map((t: string) => (
                      <Badge key={t} variant="secondary" rounded>
                        {t}
                      </Badge>
                    ))}
                  </div>
                )}
                <div className="flex gap-1 mt-1.5" onClick={(e) => e.stopPropagation()}>
                  <Button variant="ghost" size="sm" shape="square" title="Play — start a playthrough" onClick={() => setPlayStoryId(item.id)}>
                    <Play />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    shape="square"
                    title="Create manuscript adaptation"
                    disabled={adaptingId === item.id}
                    onClick={() => void adaptToManuscript(item)}
                  >
                    <ArrowRightLeft />
                  </Button>
                  <Button variant="ghost" size="sm" shape="square" title="Export" onClick={() => onExport(item.id)}>
                    <Download />
                  </Button>
                  <Button variant="ghost" size="sm" shape="square" title="Delete" onClick={() => deleteStory(item)}>
                    <Trash2 />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
        <LoadMoreSentinel
          hasMore={!!stories.hasNextPage}
          isFetching={stories.isFetchingNextPage}
          onLoadMore={() => void stories.fetchNextPage()}
        />

      </div>
      <PlayStoryDialog storyId={playStoryId} open={!!playStoryId} onClose={() => setPlayStoryId(null)} />
    </>
  );
}
