"use client";

import { useRef, useSyncExternalStore } from "react";
import Button from "@/components/ui/button";
import Dialog from "@/components/ui/dialog";

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
}

interface PendingConfirm {
  options: ConfirmOptions;
  resolve: (ok: boolean) => void;
}

let pending: PendingConfirm | null = null;
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

const getSnapshot = () => pending;
const getServerSnapshot = () => null;

function settle(ok: boolean) {
  pending?.resolve(ok);
  pending = null;
  emit();
}

/** Promise-based replacement for window.confirm, rendered by the <Confirmer /> outlet. */
export function confirmDialog(options: string | ConfirmOptions): Promise<boolean> {
  const opts = typeof options === "string" ? { message: options } : options;
  pending?.resolve(false);
  return new Promise((resolve) => {
    pending = { options: opts, resolve };
    emit();
  });
}

export function Confirmer() {
  const current = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  // keep the last options around so the dialog's close transition doesn't render empty
  const lastRef = useRef<ConfirmOptions | null>(null);
  if (current) lastRef.current = current.options;
  const opts = lastRef.current;
  return (
    <Dialog
      open={!!current}
      onOpenChange={(o) => !o && settle(false)}
      size="sm"
      title={opts?.title ?? "Are you sure?"}
      description={opts?.message}
      footer={
        <>
          <Button variant="secondary" onClick={() => settle(false)}>
            Cancel
          </Button>
          <Button variant={opts?.danger ? "danger" : "primary"} onClick={() => settle(true)}>
            {opts?.confirmLabel ?? "Confirm"}
          </Button>
        </>
      }
    />
  );
}
