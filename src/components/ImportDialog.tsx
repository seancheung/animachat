"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { Modal } from "@/components/app";
import { LIBRARY_TYPES, libraryTypeIcon } from "@/components/LibraryPicker";
import Badge from "@/components/ui/badge";
import Button from "@/components/ui/button";
import Checkbox from "@/components/ui/checkbox";
import { toast } from "@/components/ui/toast";
import { useInvalidate } from "@/lib/queries";
import type { BundlePreviewItem } from "@/lib/bundle";

const TYPE_ORDER = ["character", "persona", "location", "scene", "story", "lorebook"] as const;

/**
 * The whole bundle-import flow behind one button: pick a zip, preview its contents,
 * select in the dialog, import. Page-agnostic — a bundle can hold library items and
 * stories alike, whichever page it is opened from, so it invalidates every list.
 */
export function BundleImportButton() {
  const [preview, setPreview] = useState<{ file: File; items: BundlePreviewItem[] } | null>(null);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const invalidate = useInvalidate();
  return (
    <>
      <Button variant="secondary" onClick={() => fileRef.current?.click()}>
        <Upload /> Import
      </Button>
      <input
        ref={fileRef}
        type="file"
        hidden
        accept=".zip"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          // list the bundle first — the dialog picks what to import
          const fd = new FormData();
          fd.append("file", f);
          fd.append("preview", "1");
          const res = await fetch("/api/import", { method: "POST", body: fd });
          const data = await res.json();
          if (!res.ok) return toast.error(data?.error ?? "Import failed");
          setPreview({ file: f, items: data.items ?? [] });
        }}
      />
      <ImportDialog
        open={!!preview}
        items={preview?.items ?? []}
        importing={importing}
        onClose={() => setPreview(null)}
        onConfirm={async (selected) => {
          if (!preview) return;
          setImporting(true);
          try {
            const fd = new FormData();
            fd.append("file", preview.file);
            fd.append("selected", JSON.stringify(selected));
            const res = await fetch("/api/import", { method: "POST", body: fd });
            const data = await res.json();
            if (!res.ok) return toast.error(data?.error ?? "Import failed");
            toast.success(
              "Imported: " +
                (Object.entries(data.imported ?? {})
                  .map(([k, v]) => `${v} ${k}(s)`)
                  .join(", ") || "nothing")
            );
            setPreview(null);
            invalidate(...LIBRARY_TYPES.map((t) => t.url), "/api/library/tags", "/api/library/search");
          } finally {
            setImporting(false);
          }
        }}
      />
    </>
  );
}

/**
 * Bundle import selection: pick what to import. Checking an item locks its
 * dependencies checked (a story brings its cast, scenes and lorebooks; a
 * scene its location) — the server enforces the same closure on import.
 */
export function ImportDialog({
  open,
  items,
  importing,
  onClose,
  onConfirm,
}: {
  open: boolean;
  items: BundlePreviewItem[];
  importing: boolean;
  onClose: () => void;
  onConfirm: (selected: string[]) => void;
}) {
  const keyOf = (i: BundlePreviewItem) => `${i.type}:${i.id}`;
  const [checked, setChecked] = useState<Set<string>>(new Set());
  useEffect(() => {
    setChecked(new Set(items.map(keyOf))); // everything selected by default
  }, [items]);

  const byKey = useMemo(() => new Map(items.map((i) => [keyOf(i), i])), [items]);
  // everything the checked items depend on, transitively — shown checked & locked
  const forced = useMemo(() => {
    const out = new Set<string>();
    const visit = (k: string) => {
      if (out.has(k)) return;
      out.add(k);
      byKey.get(k)?.requires.forEach(visit);
    };
    for (const k of checked) byKey.get(k)?.requires.forEach(visit);
    return out;
  }, [checked, byKey]);

  const selected = useMemo(() => new Set([...checked, ...forced]), [checked, forced]);

  return (
    <Modal open={open} onClose={onClose} title="Import bundle" dismissable={false}>
      <div className="space-y-3">
        {items.length === 0 && (
          <div className="text-sm text-content-300">This bundle is empty.</div>
        )}
        {items.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-content-400">
              {selected.size}/{items.length} selected
            </span>
            <span className="flex-1" />
            <Button variant="ghost" size="sm" onClick={() => setChecked(new Set(items.map(keyOf)))}>
              Select all
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setChecked(new Set())}>
              None
            </Button>
          </div>
        )}
        {TYPE_ORDER.map((type) => {
          const group = items.filter((i) => i.type === type);
          if (!group.length) return null;
          const Icon = libraryTypeIcon(type);
          return (
            <div key={type}>
              <div className="text-xs uppercase tracking-wider text-content-300 mb-1 flex items-center gap-1.5">
                <Icon size={12} /> {type}s
              </div>
              <div className="space-y-1">
                {group.map((i) => {
                  const k = keyOf(i);
                  const locked = forced.has(k);
                  return (
                    <div key={k} className="flex items-center gap-2">
                      <Checkbox
                        value={checked.has(k) || locked}
                        disabled={locked}
                        onChange={(v) =>
                          setChecked((prev) => {
                            const next = new Set(prev);
                            if (v) next.add(k);
                            else next.delete(k);
                            return next;
                          })
                        }
                        label={i.name}
                      />
                      {locked && (
                        <Badge variant="secondary" rounded>
                          required
                        </Badge>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        <div className="pt-2 flex items-center gap-3">
          <Button
            disabled={selected.size === 0 || importing}
            onClick={() => onConfirm([...selected])}
          >
            {importing
              ? "Importing…"
              : `Import ${selected.size} item${selected.size === 1 ? "" : "s"}`}
          </Button>
          <Button variant="secondary" onClick={onClose} disabled={importing}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}
