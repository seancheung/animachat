"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Download, Play, Plus, ScrollText, Trash2 } from "lucide-react";
import { PlayStoryDialog } from "@/components/PlayStoryDialog";
import { BundleImportButton } from "@/components/ImportDialog";
import { LibraryPicker, type LibraryRef } from "@/components/LibraryPicker";
import { EmptyState } from "@/components/app";
import { confirmDialog } from "@/components/confirm";
import Badge from "@/components/ui/badge";
import Button from "@/components/ui/button";
import Input from "@/components/ui/input";
import LoadMoreSentinel from "@/components/ui/load-more";
import SegmentedControl from "@/components/ui/segmented-control";
import Select from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { useDebouncedValue, useGet, useInvalidate, usePagedList } from "@/lib/queries";
import { api, assetUrl, downloadBlob } from "@/lib/ui";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Chat-list timestamp: time for today, month+day this year, short date otherwise. */
function fmtWhen(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (d.getFullYear() === now.getFullYear())
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return d.toLocaleDateString(undefined, { dateStyle: "short" });
}

/**
 * The Stories section: the story grid (self-contained works, edited on their own
 * pages) and the playthrough list — story-mode chats live here, not on the Chats
 * page. Playthrough rows carry the story name from their snapshot, so runs of a
 * deleted story still show under its name.
 */
export default function StoriesPage() {
  const router = useRouter();
  const invalidate = useInvalidate();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"updated" | "created" | "name">("updated");
  const [tagFilter, setTagFilter] = useState("");
  const [playStoryId, setPlayStoryId] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportMode, setExportMode] = useState<"selected" | "all">("selected");
  const [exportSel, setExportSel] = useState<LibraryRef[]>([]);
  const [exporting, setExporting] = useState(false);

  const needle = useDebouncedValue(q.trim());
  const stories = usePagedList<any>("/api/stories", {
    q: needle || undefined,
    tag: tagFilter || undefined,
    sort,
  });
  const plays = usePagedList<any>("/api/chats", { kind: "playthroughs", q: needle || undefined });
  const { data: tagsData } = useGet<{ tags: string[] }>("/api/library/tags?type=story");
  const allTags = tagsData?.tags ?? [];
  const filtered = !!(needle || tagFilter);
  const refresh = () => invalidate("/api/stories", "/api/library/tags", "/api/library/search");

  async function exportItems(body: { items?: { type: string; id: string }[]; all?: "stories" }) {
    const res = await fetch("/api/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      return toast.error(data?.error ?? "Export failed");
    }
    await downloadBlob(res, "animachat-bundle.zip");
  }
  const exportStory = (id: string) => exportItems({ items: [{ type: "story", id }] });

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

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto p-6 space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <Input
            className="flex-1"
            placeholder="Search stories & playthroughs…"
            value={q}
            onChange={setQ}
          />
          <div className="w-50">
            <Select
              className="w-full"
              value={sort}
              onChange={setSort}
              options={[
                { value: "updated", label: "Recently updated" },
                { value: "created", label: "Newest first" },
                { value: "name", label: "Name A–Z" },
              ]}
            />
          </div>
          {allTags.length > 0 && (
            <div className="w-50">
              <Select
                className="w-full"
                value={tagFilter}
                onChange={setTagFilter}
                options={[{ value: "", label: "All tags" }, ...allTags.map((t) => ({ value: t, label: t }))]}
              />
            </div>
          )}
          <BundleImportButton />
          <Button
            variant="secondary"
            onClick={() => {
              setExportSel([]);
              setExportMode("selected");
              setExportOpen(true);
            }}
          >
            <Download /> Export
          </Button>
          <Button className="whitespace-nowrap" onClick={() => router.push("/stories/new")}>
            <Plus /> New story
          </Button>
        </div>

        {!stories.isLoading && stories.items.length === 0 && !filtered && (
          <EmptyState>
            No stories yet — a story is a self-contained work: its cast, scenes, places and lore
            live inside it. Create one and the AI co-writer can build the whole thing with you
            (or extract it from an attached novel).
          </EmptyState>
        )}
        {!stories.isLoading && stories.items.length === 0 && filtered && (
          <EmptyState>
            No stories match {needle ? `“${needle}”` : `the tag “${tagFilter}”`}.
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
                  <Button variant="ghost" size="sm" shape="square" title="Export" onClick={() => exportStory(item.id)}>
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

        <div className="pt-2">
          <div className="text-xs uppercase tracking-wider text-content-300 mb-2">Playthroughs</div>
          {!plays.isLoading && plays.items.length === 0 && (
            <EmptyState>
              {needle
                ? "No playthroughs match."
                : "No playthroughs yet — hit Play on a story above. Fork any message to replay from that point; each finished run is one of the story's endings."}
            </EmptyState>
          )}
          <div className="space-y-2">
            {plays.items.map((c) => (
              <div
                key={c.id}
                className="panel p-3 cursor-pointer hover:border-primary-500 transition-colors group flex items-center gap-3"
                onClick={() => router.push(`/chat/${c.id}`)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-medium truncate">{c.title}</span>
                    {c.ended && (
                      <Badge size="sm" rounded className="shrink-0">
                        The End
                      </Badge>
                    )}
                    {c.storyName && (
                      <Badge variant="secondary" size="sm" rounded className="ml-auto shrink-0">
                        {c.storyName}
                      </Badge>
                    )}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-xs min-w-0">
                    <span className="shrink-0 size-6 rounded-full bg-base-300 flex items-center justify-center text-content-300">
                      <ScrollText size={14} />
                    </span>
                    <span className="min-w-0 truncate text-content-300">{c.characterNames.join(", ")}</span>
                  </div>
                  {c.lastMessage && (
                    <div className="mt-0.5 text-xs text-content-400 truncate">{c.lastMessage}</div>
                  )}
                </div>
                <div className="relative shrink-0 self-stretch min-w-16">
                  <div className="h-full flex flex-col items-end justify-center transition-opacity group-hover:opacity-0">
                    <span className="text-xs text-content-300">{fmtWhen(c.updatedAt)}</span>
                    <span className="text-tiny text-content-400">{c.messageCount} msgs</span>
                  </div>
                  <div className="absolute inset-0 flex items-center justify-end gap-1 opacity-0 pointer-events-none transition-opacity group-hover:opacity-100 group-hover:pointer-events-auto">
                    <Button
                      variant="ghost"
                      size="sm"
                      shape="square"
                      title="Export chat archive"
                      onClick={async (e) => {
                        e.stopPropagation();
                        await downloadBlob(await fetch(`/api/chats/${c.id}/archive`), "chat.zip");
                      }}
                    >
                      <Download />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      shape="square"
                      title="Delete playthrough"
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (
                          await confirmDialog({
                            title: "Delete playthrough",
                            message: `Delete "${c.title}"?`,
                            confirmLabel: "Delete",
                            danger: true,
                          })
                        ) {
                          await api.del(`/api/chats/${c.id}`);
                          void invalidate("/api/chats");
                        }
                      }}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
            <LoadMoreSentinel
              hasMore={!!plays.hasNextPage}
              isFetching={plays.isFetchingNextPage}
              onLoadMore={() => void plays.fetchNextPage()}
            />
          </div>
        </div>
      </div>
      <PlayStoryDialog storyId={playStoryId} open={!!playStoryId} onClose={() => setPlayStoryId(null)} />

      <LibraryPicker
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        title="Export stories"
        header={
          <SegmentedControl
            variant="secondary"
            className="w-full"
            items={[
              { value: "selected", label: "Selected stories" },
              { value: "all", label: "All stories" },
            ]}
            value={exportMode}
            onChange={setExportMode}
          />
        }
        hint={
          exportMode === "all"
            ? "Every story — each a self-contained bundle item with its embedded cast, scenes, places, lore and assets — in a single zip."
            : "Check stories to export — each is self-contained (embedded cast, scenes, places, lore and assets travel inside it)."
        }
        selection={exportSel}
        onChange={setExportSel}
        hidePicker={exportMode === "all"}
        types={["story"]}
        placeholder="Search stories…"
        footer={
          <>
            <Button variant="secondary" onClick={() => setExportOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={exporting || (exportMode === "selected" && !exportSel.length)}
              onClick={async () => {
                setExporting(true);
                try {
                  // all-stories mode enumerates server-side — the client only sees pages
                  await exportItems(
                    exportMode === "all"
                      ? { all: "stories" }
                      : { items: exportSel.map(({ type, id }) => ({ type, id })) }
                  );
                  setExportOpen(false);
                } finally {
                  setExporting(false);
                }
              }}
            >
              <Download />{" "}
              {exporting
                ? "Exporting…"
                : exportMode === "all"
                  ? "Export all stories"
                  : `Export ${exportSel.length || ""} stor${exportSel.length === 1 ? "y" : "ies"}`}
            </Button>
          </>
        }
      />
    </div>
  );
}
