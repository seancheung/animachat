export type NavigationGuard = () => boolean | Promise<boolean>;

let activeGuard: NavigationGuard | null = null;

/** Register the leave guard owned by the currently mounted editor page. */
export function registerNavigationGuard(guard: NavigationGuard): () => void {
  activeGuard = guard;
  return () => {
    if (activeGuard === guard) activeGuard = null;
  };
}

/** Ask the active page whether client-side navigation may continue. */
export async function confirmNavigation(): Promise<boolean> {
  return activeGuard ? await activeGuard() : true;
}
