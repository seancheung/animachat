"use client";

import { useEffect, useRef } from "react";
import { Loader2Icon } from "lucide-react";
import { cn } from "@/utils/cn";

/** Infinite-scroll sentinel for row/card lists: fires onLoadMore when scrolled near. */
export default function LoadMoreSentinel({
  hasMore,
  isFetching,
  onLoadMore,
  className,
}: {
  hasMore: boolean;
  isFetching: boolean;
  onLoadMore: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!hasMore) return;
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isFetching) onLoadMore();
      },
      { rootMargin: "120px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, isFetching, onLoadMore]);
  if (!hasMore && !isFetching) return null;
  return (
    <div ref={ref} className={cn("flex justify-center py-3", className)}>
      {isFetching && <Loader2Icon className="size-4 animate-spin text-content-400" />}
    </div>
  );
}
