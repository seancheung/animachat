import { Suspense } from "react";
import { Studio } from "@/components/studio/Studio";

export default function StudioPage() {
  return (
    <Suspense fallback={<div className="p-6 text-content-400">Loading Studio…</div>}>
      <Studio />
    </Suspense>
  );
}
