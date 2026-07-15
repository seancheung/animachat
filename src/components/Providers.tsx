"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/** Client boundary for app-wide providers (the root layout stays a server component). */
export function Providers({ children }: { children: React.ReactNode }) {
  // retry off: a local single-user server has no transient failures worth masking;
  // short staleTime keeps SWR-like revalidate-on-mount behavior
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 5_000 } } })
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
