"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { CheckIcon, XIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { cn } from "@/utils/cn";
import Button from "./button";

type ToastVariant = "default" | "success" | "warning" | "error" | "info";

export type ToastData = {
  id: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  variant: ToastVariant;
  duration: number;
  icon?: React.ReactNode;
  action?: { label: React.ReactNode; onClick: () => void };
};

let counter = 0;
let store: ToastData[] = [];
const EMPTY: ToastData[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return store;
}

function getServerSnapshot(): ToastData[] {
  return EMPTY;
}

export type ToastInput =
  | string
  | (Partial<Omit<ToastData, "id" | "variant">> & {
      title?: React.ReactNode;
    });

function build(input: ToastInput, variant: ToastVariant): ToastData {
  const data = typeof input === "string" ? { title: input } : input;
  return {
    duration: 4000,
    ...data,
    id: `toast-${++counter}`,
    variant,
  };
}

function push(t: ToastData) {
  store = [...store, t];
  emit();
  return t.id;
}

function dismiss(id?: string) {
  store = id ? store.filter((t) => t.id !== id) : [];
  emit();
}

export const toast = Object.assign(
  (input: ToastInput) => push(build(input, "default")),
  {
    success: (input: ToastInput) => push(build(input, "success")),
    warning: (input: ToastInput) => push(build(input, "warning")),
    error: (input: ToastInput) => push(build(input, "error")),
    info: (input: ToastInput) => push(build(input, "info")),
    dismiss,
  },
);

const containerVariants = cva(
  "pointer-events-none fixed z-60 flex max-h-screen flex-col gap-2 p-4",
  {
    variants: {
      position: {
        "top-right": "top-0 right-0 items-end",
        "top-left": "top-0 left-0 items-start",
        "top-center": "top-0 left-1/2 -translate-x-1/2 items-center",
        "bottom-right": "right-0 bottom-0 items-end",
        "bottom-left": "bottom-0 left-0 items-start",
        "bottom-center": "bottom-0 left-1/2 -translate-x-1/2 items-center",
      },
    },
    defaultVariants: {
      position: "top-right",
    },
  },
);

export type ToasterProps = VariantProps<typeof containerVariants>;

export function Toaster({ position }: ToasterProps = {}) {
  const items = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const isTop = (position ?? "top-right").startsWith("top");
  const ordered = isTop ? items : [...items].reverse();

  return (
    <section
      className={cn(containerVariants({ position }))}
      aria-label="Notifications"
    >
      <AnimatePresence initial={false}>
        {ordered.map((t) => (
          <ToastItem key={t.id} toast={t} fromTop={isTop} />
        ))}
      </AnimatePresence>
    </section>
  );
}

const itemVariants = cva(
  "pointer-events-auto flex w-90 max-w-[calc(100vw-2rem)] items-start gap-3 rounded-md border px-4 py-3 text-sm shadow-(--shadow-overlay) backdrop-blur",
  {
    variants: {
      variant: {
        default: "border-base-400 bg-base-400/95",
        success: "border-success/25 bg-success/15",
        warning: "border-warning/25 bg-warning/15",
        error: "border-error/25 bg-error/15",
        info: "border-info/25 bg-info/15",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

const badgeVariants = cva(
  "has-icon-3 mt-px inline-flex size-4 shrink-0 items-center justify-center rounded-full icon:stroke-3",
  {
    variants: {
      variant: {
        success: "bg-success text-success-content",
        warning: "bg-warning text-warning-content",
        error: "bg-error text-error-content",
        info: "bg-info text-info-content",
      },
    },
  },
);

const ICONS = {
  success: CheckIcon,
  warning: () => <b>!</b>,
  error: XIcon,
  info: () => <b>i</b>,
} as const;

function ToastItem({
  toast: t,
  fromTop,
}: {
  toast: ToastData;
  fromTop: boolean;
}) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remainingRef = useRef(t.duration);
  const startedAtRef = useRef(0);
  const hasTimer = t.duration > 0 && Number.isFinite(t.duration);

  useEffect(() => {
    if (!hasTimer) return;
    remainingRef.current = t.duration;
    startedAtRef.current = Date.now();
    timerRef.current = setTimeout(() => dismiss(t.id), t.duration);
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [t.id, t.duration, hasTimer]);

  function pauseTimer() {
    if (timerRef.current === null) return;
    clearTimeout(timerRef.current);
    timerRef.current = null;
    remainingRef.current -= Date.now() - startedAtRef.current;
  }

  function resumeTimer() {
    if (!hasTimer || timerRef.current !== null) return;
    startedAtRef.current = Date.now();
    timerRef.current = setTimeout(
      () => dismiss(t.id),
      Math.max(remainingRef.current, 0),
    );
  }

  const semantic = t.variant === "default" ? null : t.variant;
  const Icon = semantic ? ICONS[semantic] : null;
  const offset = fromTop ? -16 : 16;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: offset, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.15 } }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className={cn(itemVariants({ variant: t.variant }))}
      role="status"
      onMouseEnter={pauseTimer}
      onMouseLeave={resumeTimer}
    >
      {(t.icon != null || semantic) && (
        <span
          className={cn(
            semantic
              ? badgeVariants({ variant: semantic })
              : "has-icon-3 mt-px inline-flex size-4 shrink-0 items-center justify-center",
          )}
        >
          {t.icon ?? (Icon && <Icon />)}
        </span>
      )}
      <div className="min-w-0 flex-1">
        {t.title && (
          <div className="font-semibold text-content-100">{t.title}</div>
        )}
        {t.description && (
          <div className={cn("text-content-200", t.title && "mt-0.5 text-xs")}>
            {t.description}
          </div>
        )}
      </div>
      {t.action && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            t.action?.onClick();
            dismiss(t.id);
          }}
          className="-my-1 shrink-0"
        >
          {t.action.label}
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        shape="circle"
        onClick={() => dismiss(t.id)}
        aria-label="Close"
        className="-mr-1 size-6 shrink-0"
      >
        <XIcon />
      </Button>
    </motion.div>
  );
}

export default Toaster;
