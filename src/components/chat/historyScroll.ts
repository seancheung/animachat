/** Observe proximity to the oldest message, including direct scrollbar jumps. */
export function watchHistoryTop(root: HTMLElement, sentinel: HTMLElement, load: () => void) {
  let active = true;
  const checkPosition = () => {
    if (active && root.scrollTop <= 300) load();
  };
  const observer = new IntersectionObserver(
    (entries) => {
      if (active && entries.some((entry) => entry.isIntersecting)) load();
    },
    { root, rootMargin: "300px 0px 0px 0px" }
  );
  observer.observe(sentinel);
  root.addEventListener("scroll", checkPosition, { passive: true });
  // Also recheck on attachment: a short log or a reader already at the top
  // should not need to leave and re-enter the observer's intersection area.
  checkPosition();
  return () => {
    active = false;
    observer.disconnect();
    root.removeEventListener("scroll", checkPosition);
  };
}
