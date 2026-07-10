"use client";

import { type ReactNode, useEffect } from "react";
import { cls } from "@/lib/ui";

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
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 fade-in"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className={cls(
          "panel max-h-[92vh] overflow-y-auto p-5 w-full",
          wide ? "max-w-5xl" : "max-w-xl"
        )}
      >
        {title && (
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">{title}</h2>
            <button className="btn btn-ghost btn-sm" onClick={onClose}>
              ✕
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
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
  return (
    <label className={cls("block", className)}>
      <div className="text-xs uppercase tracking-wider text-[var(--text-dim)] mb-1">{label}</div>
      {children}
      {hint && <div className="text-xs text-[var(--text-dim)] mt-1">{hint}</div>}
    </label>
  );
}

export function Row({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cls("flex gap-3 items-end flex-wrap", className)}>{children}</div>;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="text-center text-[var(--text-dim)] py-16 text-sm border border-dashed border-[var(--border)] rounded-xl">
      {children}
    </div>
  );
}

export function Spinner() {
  return <span className="inline-block animate-spin">◌</span>;
}
