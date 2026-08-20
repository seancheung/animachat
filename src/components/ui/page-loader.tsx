import { LoaderCircle } from "lucide-react";

export default function PageLoader({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex h-full items-center justify-center" role="status" aria-live="polite">
      <LoaderCircle className="size-6 animate-spin text-content-400" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </div>
  );
}
