"use client";

import { cn } from "@/utils/cn";

export default function Skeleton({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-base-400/60", className)}
      {...props}
    />
  );
}
