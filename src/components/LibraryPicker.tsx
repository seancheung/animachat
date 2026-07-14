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
 * needs a confirm action (e.g. Export).
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
  // selected items ride along so their tags (and checkmarks) always resolve to names
  const withSelected = [
    ...matches,
    ...selection.filter((r) => !matches.some((m) => keyOf(m) === keyOf(r))),
  ];
  const options: MultiComboboxOption<string>[] = withSelected.map((i) => ({
    value: keyOf(i),
    label: i.name,
  }));

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="space-y-3">
        {hint && <div className="text-xs text-content-400">{hint}</div>}
        <MultiCombobox
          className="w-full"
          placeholder="Search the library…"
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
