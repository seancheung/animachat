"use client";

import { useState, type ReactNode } from "react";
import useSWR from "swr";
import {
  BookOpen,
  Clapperboard,
  LibraryBig,
  Mountain,
  Paperclip,
  UserRound,
  VenetianMask,
} from "lucide-react";
import { Modal } from "@/components/app";
import Button from "@/components/ui/button";
import Checkbox from "@/components/ui/checkbox";
import Input from "@/components/ui/input";
import { api } from "@/lib/ui";

/** A library item picked in the dialog. */
export interface LibraryRef {
  type: string;
  id: string;
  name: string;
}

export const LIBRARY_TYPES = [
  { type: "character", label: "Characters", url: "/api/characters", Icon: UserRound },
  { type: "persona", label: "Personas", url: "/api/personas", Icon: VenetianMask },
  { type: "location", label: "Locations", url: "/api/locations", Icon: Mountain },
  { type: "scene", label: "Scenes", url: "/api/scenes", Icon: Clapperboard },
  { type: "story", label: "Stories", url: "/api/stories", Icon: BookOpen },
  { type: "lorebook", label: "Lorebooks", url: "/api/lorebooks", Icon: LibraryBig },
] as const;

export const libraryTypeIcon = (type: string) =>
  LIBRARY_TYPES.find((t) => t.type === type)?.Icon ?? Paperclip;

function PickerSection({
  t,
  open,
  filter,
  selection,
  onChange,
}: {
  t: (typeof LIBRARY_TYPES)[number];
  open: boolean;
  filter: string;
  selection: LibraryRef[];
  onChange: (selection: LibraryRef[]) => void;
}) {
  const { data } = useSWR<{ id: string; name: string }[]>(open ? t.url : null, api.get);
  const items = (data ?? []).filter((i) => i.name.toLowerCase().includes(filter));
  if (items.length === 0) return null;
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-content-300 mb-1 flex items-center gap-1.5">
        <t.Icon size={12} /> {t.label}
      </div>
      <div className="space-y-1">
        {items.map((i) => (
          <Checkbox
            key={i.id}
            className="flex"
            label={i.name}
            value={selection.some((r) => r.type === t.type && r.id === i.id)}
            onChange={(v) =>
              onChange(
                v
                  ? [...selection, { type: t.type, id: i.id, name: i.name }]
                  : selection.filter((r) => !(r.type === t.type && r.id === i.id))
              )
            }
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Multi-select dialog over the whole library (all entity types, name filter).
 * Toggles apply to `selection` immediately; `footer` replaces the default Done
 * button when the caller needs a confirm action (e.g. Export).
 */
export function LibraryPicker({
  open,
  onClose,
  title,
  hint,
  selection,
  onChange,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  hint?: string;
  selection: LibraryRef[];
  onChange: (selection: LibraryRef[]) => void;
  footer?: ReactNode;
}) {
  const [filter, setFilter] = useState("");
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="space-y-3">
        {hint && <div className="text-xs text-content-400">{hint}</div>}
        <Input className="w-full" placeholder="Filter by name…" value={filter} onChange={setFilter} />
        <div className="max-h-[50vh] overflow-y-auto space-y-4 pr-1">
          {LIBRARY_TYPES.map((t) => (
            <PickerSection
              key={t.type}
              t={t}
              open={open}
              filter={filter.trim().toLowerCase()}
              selection={selection}
              onChange={onChange}
            />
          ))}
        </div>
        <div className="flex justify-end gap-2">
          {footer ?? (
            <Button variant="secondary" onClick={onClose}>
              Done
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
