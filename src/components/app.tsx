"use client";

import { useRef, type KeyboardEvent, type ReactNode, type Ref } from "react";
import Dialog from "@/components/ui/dialog";
import { cn } from "@/utils/cn";

/** App-standard modal: thin adapter over the ui Dialog keeping open/onClose call sites simple. */
export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
  dismissable,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  wide?: boolean;
  /** false = only the close button dismisses (not Esc / clicking the overlay) */
  dismissable?: boolean;
}) {
  // call sites render children as `{state && <Editor/>}`, which becomes falsy
  // the moment the modal closes — keep the last real children through the
  // close transition so the dialog doesn't collapse while fading out
  const lastChildren = useRef(children);
  if (open) lastChildren.current = children;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={title}
      dismissable={dismissable}
      className={wide ? "max-w-5xl" : undefined}
    >
      {open ? children : lastChildren.current}
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

/** Message input with a toolbar inside its frame: a borderless textarea over a bottom
 *  row of (icon) buttons. Mirrors the ui Textarea's look, moving the focus treatment
 *  to the frame via focus-within so the whole box reads as one input. */
export function InputBox({
  value,
  onChange,
  onKeyDown,
  placeholder,
  disabled,
  textareaRef,
  textareaClassName,
  className,
  children,
  backdrop,
}: {
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  /** disables typing only — toolbar buttons manage their own disabled state */
  disabled?: boolean;
  textareaRef?: Ref<HTMLTextAreaElement>;
  textareaClassName?: string;
  className?: string;
  /** toolbar content; use a flex-1 spacer to split left/right groups */
  children?: ReactNode;
  /** styled mirror of `value` rendered behind a transparent-text textarea (chip
   *  highlighting); it must reproduce the text with identical glyph metrics */
  backdrop?: ReactNode;
}) {
  const backdropRef = useRef<HTMLDivElement>(null);
  return (
    <div
      className={cn(
        "rounded-md border border-base-400 bg-base-100 transition-all",
        "focus-within:border-primary-500 focus-within:ring-3 focus-within:ring-primary-500/10",
        className
      )}
    >
      <div className="relative">
        {backdrop != null && (
          <div
            ref={backdropRef}
            aria-hidden
            className={cn(
              "absolute inset-0 overflow-hidden whitespace-pre-wrap break-words px-3 pt-2 pb-0.5 text-content-100 text-sm pointer-events-none",
              textareaClassName
            )}
          >
            {backdrop}
          </div>
        )}
        <textarea
          ref={textareaRef}
          className={cn(
            "block w-full h-14 resize-none bg-transparent px-3 pt-2 pb-0.5 text-content-100 text-sm outline-none disabled:opacity-40",
            backdrop != null && "relative text-transparent [caret-color:var(--color-content-100)]",
            textareaClassName
          )}
          placeholder={placeholder}
          disabled={disabled}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onScroll={(e) => {
            if (backdropRef.current) backdropRef.current.scrollTop = e.currentTarget.scrollTop;
          }}
        />
      </div>
      <div className="flex items-center gap-1 px-1.5 pb-1.5">{children}</div>
    </div>
  );
}

export function Row({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex gap-3 items-end flex-wrap", className)}>{children}</div>;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="text-center text-content-300 px-6 py-16 text-sm border border-dashed border-base-400 rounded-lg">
      {children}
    </div>
  );
}
