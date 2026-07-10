"use client";

import type { ReactNode } from "react";
import Dialog from "@/components/ui/dialog";
import { cn } from "@/utils/cn";

/** App-standard modal: thin adapter over the ui Dialog keeping open/onClose call sites simple. */
export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={title}
      className={wide ? "max-w-5xl" : undefined}
    >
      {children}
    </Dialog>
  );
}

export function Field({
  label,
  children,
  hint,
  className,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  className?: string;
}) {
  // deliberately a div, not a label: labels re-dispatch clicks to the first
  // button child, which double-fires toggle buttons rendered inside a Field
  return (
    <div className={cn("block", className)}>
      <div className="text-xs uppercase tracking-wider text-content-300 mb-1">{label}</div>
      {children}
      {hint && <div className="text-xs text-content-400 mt-1">{hint}</div>}
    </div>
  );
}

export function Row({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex gap-3 items-end flex-wrap", className)}>{children}</div>;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="text-center text-content-300 py-16 text-sm border border-dashed border-base-400 rounded-lg">
      {children}
    </div>
  );
}
