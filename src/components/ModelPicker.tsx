"use client";

import useSWR from "swr";
import { api } from "@/lib/ui";
import type { Model, Provider } from "@/lib/types";

export function useProviders() {
  return useSWR<{ providers: Provider[]; models: Model[] }>("/api/providers", api.get);
}

/** Grouped provider→model select. Empty value = inherit/default. */
export function ModelPicker({
  value,
  onChange,
  placeholder = "(default)",
  className,
}: {
  value: string | null | undefined;
  onChange: (modelId: string | null) => void;
  placeholder?: string;
  className?: string;
}) {
  const { data } = useProviders();
  return (
    <select
      className={className ?? "input"}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
    >
      <option value="">{placeholder}</option>
      {data?.providers.map((p) => (
        <optgroup key={p.id} label={p.name}>
          {data.models
            .filter((m) => m.providerId === p.id)
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  );
}
