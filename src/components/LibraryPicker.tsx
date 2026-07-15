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
  X,
} from "lucide-react";
import { Modal } from "@/components/app";
import Button from "@/components/ui/button";
import MultiCombobox, { type MultiComboboxOption } from "@/components/ui/multi-combobox";
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

/** How many matches the dropdown offers at once — search narrows, nothing lists the whole library. */
const MAX_MATCHES = 30;

/**
 * Multi-select dialog over the whole library (all entity types): a search-as-you-type
 * combobox instead of a full listing, so any library size stays manageable. Picks apply
 * to `selection` immediately; `footer` replaces the default Done button when the caller
 * needs a confirm action (e.g. Export). `header` renders above the hint (e.g. a mode
 * switch); `hidePicker` drops the search & selection UI for modes where picking
 * individual items doesn't apply.
 */
export function LibraryPicker({
  open,
  onClose,
  title,
  header,
  hint,
  selection,
  onChange,
  footer,
  hidePicker,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  header?: ReactNode;
  hint?: string;
  selection: LibraryRef[];
  onChange: (selection: LibraryRef[]) => void;
  footer?: ReactNode;
  hidePicker?: boolean;
}) {
  const [query, setQuery] = useState("");
  // one fetch across all six lists when the dialog opens (SWR-cached between opens)
  const { data: all } = useSWR<LibraryRef[]>(
    open ? "library-picker:index" : null,
    async () => {
      const lists = await Promise.all(LIBRARY_TYPES.map((t) => api.get(t.url)));
      return LIBRARY_TYPES.flatMap((t, i) =>
        (lists[i] as { id: string; name: string }[]).map((x) => ({
          type: t.type,
          id: x.id,
          name: x.name,
        }))
      );
    }
  );

  const keyOf = (r: { type: string; id: string }) => `${r.type}:${r.id}`;
  const q = query.trim().toLowerCase();
  const matches = (all ?? []).filter((i) => !q || i.name.toLowerCase().includes(q)).slice(0, MAX_MATCHES);
  const options: MultiComboboxOption<string>[] = matches.map((i) => ({
    value: keyOf(i),
    label: i.name,
  }));

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="space-y-3">
        {header}
        {hint && <div className="text-xs text-content-400">{hint}</div>}
        {!hidePicker && (
          <MultiCombobox
            className="w-full"
            placeholder="Search the library…"
            hideTags
            value={selection.map(keyOf)}
            options={options}
            loading={open && !all}
            onSearch={setQuery}
            onChange={(keys) =>
              onChange(
                keys
                  .map(
                    (k) =>
                      selection.find((r) => keyOf(r) === k) ??
                      (all ?? []).find((i) => keyOf(i) === k)
                  )
                  .filter((r): r is LibraryRef => !!r)
              )
            }
            renderOption={(opt) => {
              const [type] = String(opt.value).split(":");
              const Icon = libraryTypeIcon(type);
              return (
                <span className="flex flex-1 min-w-0 items-center gap-1.5">
                  <Icon size={12} className="shrink-0 text-content-400" />
                  <span className="truncate">{opt.label}</span>
                  <span className="ml-auto shrink-0 text-[10px] text-content-400">{type}</span>
                </span>
              );
            }}
          />
        )}
        {!hidePicker && selection.length > 0 && (
          <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
            {selection.map((r) => {
              const Icon = libraryTypeIcon(r.type);
              return (
                <div
                  key={keyOf(r)}
                  className="flex items-center gap-2 rounded-md bg-base-200 px-2.5 py-1.5 text-sm"
                >
                  <Icon size={13} className="shrink-0 text-content-400" />
                  <span className="flex-1 truncate">{r.name}</span>
                  <span className="shrink-0 text-[10px] text-content-400">{r.type}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    shape="square"
                    title="Remove"
                    onClick={() => onChange(selection.filter((x) => keyOf(x) !== keyOf(r)))}
                  >
                    <X />
                  </Button>
                </div>
              );
            })}
          </div>
        )}
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
