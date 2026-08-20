"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, Download, FileText, Trash2 } from "lucide-react";
import { EmptyState } from "@/components/app";
import { confirmDialog } from "@/components/confirm";
import Badge from "@/components/ui/badge";
import Button from "@/components/ui/button";
import LoadMoreSentinel from "@/components/ui/load-more";
import { toast } from "@/components/ui/toast";
import { useInvalidate, usePagedList } from "@/lib/queries";
import { api } from "@/lib/ui";

/* eslint-disable @typescript-eslint/no-explicit-any */

export function Manuscripts({
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
  const [adaptingId, setAdaptingId] = useState<string | null>(null);
  const list = usePagedList<any>("/api/manuscripts", {
    q: query || undefined,
    tag: tag || undefined,
    sort,
  });

  const refresh = () => invalidate("/api/manuscripts");

  async function deleteManuscript(item: any) {
    if (!(await confirmDialog({
      title: "Delete manuscript",
      message: `Delete “${item.name}”? Its chapters, embedded characters, and assistant sessions will be removed.`,
      confirmLabel: "Delete",
      danger: true,
    }))) return;
    await api.del(`/api/manuscripts/${item.id}`);
    await refresh();
  }

  async function adaptToStory(item: any) {
    if (!(await confirmDialog({
      title: "Create interactive adaptation?",
      message: "This creates an independent interactive-story scaffold with the manuscript's synopsis, embedded characters, and one scene per chapter. Manuscript prose stays in the original and is not copied into playthrough prompts.",
      confirmLabel: "Create story",
    }))) return;
    setAdaptingId(item.id);
    try {
      const result = await api.post<{ id: string }>("/api/library/adapt", { sourceType: "manuscript", id: item.id });
      toast.success("Interactive adaptation created");
      router.push(`/stories/${result.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setAdaptingId(null);
    }
  }

  return (
    <div className="space-y-4">
      {!list.isLoading && !list.items.length && (
        <EmptyState>
          {query || tag
            ? query
              ? `No manuscripts match “${query}”.`
              : `No manuscripts match the tag “${tag}”.`
            : "No manuscripts yet — start a project, add chapters and characters, then write alongside the AI assistant."}
        </EmptyState>
      )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {list.items.map((item) => (
            <article
              key={item.id}
              className="panel p-4 min-h-48 flex flex-col cursor-pointer hover:border-primary-500 transition-colors"
              onClick={() => router.push(`/manuscripts/${item.id}`)}
            >
              <div className="flex items-start gap-3">
                <div className="size-10 rounded-md bg-primary-500/10 text-primary-500 flex items-center justify-center shrink-0">
                  <FileText size={20} />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="font-medium truncate">{item.name}</h2>
                  <div className="text-xs text-content-400 mt-0.5">
                    {item.chapters?.length ?? 0} chapter{item.chapters?.length === 1 ? "" : "s"} · {item.characters?.length ?? 0} character{item.characters?.length === 1 ? "" : "s"}
                  </div>
                </div>
              </div>
              <p className="text-sm text-content-300 line-clamp-4 mt-3 flex-1">
                {item.synopsis || "No synopsis yet."}
              </p>
              {item.tags?.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {item.tags.slice(0, 4).map((tag: string) => <Badge key={tag} variant="secondary" rounded>{tag}</Badge>)}
                </div>
              )}
              <div className="flex gap-1 mt-3 -ml-1" onClick={(e) => e.stopPropagation()}>
                <Button
                  variant="ghost" size="sm" shape="square" title="Create interactive adaptation"
                  disabled={adaptingId === item.id}
                  onClick={() => void adaptToStory(item)}
                ><ArrowRightLeft /></Button>
                <Button
                  variant="ghost" size="sm" shape="square" title="Export manuscript"
                  onClick={() => onExport(item.id)}
                ><Download /></Button>
                <Button variant="ghost" size="sm" shape="square" title="Delete manuscript" onClick={() => deleteManuscript(item)}>
                  <Trash2 />
                </Button>
              </div>
            </article>
          ))}
        </div>
        <LoadMoreSentinel
          hasMore={!!list.hasNextPage}
          isFetching={list.isFetchingNextPage}
          onLoadMore={() => void list.fetchNextPage()}
        />
    </div>
  );
}
