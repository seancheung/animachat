"use client";

import Select from "@/components/ui/select";
import { useGet } from "@/lib/queries";
import type { Model, Provider } from "@/lib/types";

export function useProviders() {
  return useGet<{ providers: Provider[]; models: Model[] }>("/api/providers");
}

/** Provider→model select. Empty value = inherit/default. */
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
  const options =
    data?.providers.flatMap((p) =>
      data.models
        .filter((m) => m.providerId === p.id)
        .map((m) => ({ value: m.id, label: `${p.name} · ${m.displayName}` }))
    ) ?? [];
  return (
    <Select
      className={className ?? "w-full"}
      value={value ?? null}
      onChange={(v) => onChange(v)}
      options={options}
      placeholder={placeholder}
      emptyMessage="No models — add a provider in Settings"
      clearable
      onClear={() => onChange(null)}
    />
  );
}
