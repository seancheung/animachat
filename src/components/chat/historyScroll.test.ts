import { afterEach, describe, expect, it, vi } from "vitest";
import { watchHistoryTop } from "./historyScroll";

function setup(scrollTop = 900) {
  const root = Object.assign(new EventTarget(), { scrollTop }) as unknown as HTMLElement;
  const sentinel = {} as HTMLElement;
  let intersect!: (entries: Partial<IntersectionObserverEntry>[]) => void;
  const disconnect = vi.fn();
  const observe = vi.fn();
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: typeof intersect) { intersect = callback; }
    observe = observe;
    disconnect = disconnect;
  });
  const load = vi.fn();
  return { root, sentinel, load, observe, disconnect,
    intersect: (visible: boolean) => intersect([{ isIntersecting: visible }]) };
}

afterEach(() => vi.unstubAllGlobals());

describe("history scroll triggers", () => {
  it("loads on a direct jump to the top without an intersection notification", () => {
    const s = setup();
    const stop = watchHistoryTop(s.root, s.sentinel, s.load);
    expect(s.load).not.toHaveBeenCalled();
    s.root.scrollTop = 0;
    s.root.dispatchEvent(new Event("scroll"));
    expect(s.load).toHaveBeenCalledOnce();
    stop();
  });

  it("prefetches near the top but ignores scrolling farther down", () => {
    const s = setup();
    const stop = watchHistoryTop(s.root, s.sentinel, s.load);
    s.root.scrollTop = 301;
    s.root.dispatchEvent(new Event("scroll"));
    expect(s.load).not.toHaveBeenCalled();
    s.root.scrollTop = 300;
    s.root.dispatchEvent(new Event("scroll"));
    expect(s.load).toHaveBeenCalledOnce();
    stop();
  });

  it("checks an already mounted short log without waiting for a scroll", () => {
    const s = setup(0);
    const stop = watchHistoryTop(s.root, s.sentinel, s.load);
    expect(s.observe).toHaveBeenCalledWith(s.sentinel);
    expect(s.load).toHaveBeenCalledOnce();
    stop();
  });

  it("keeps intersection prefetch and removes both triggers on cleanup", () => {
    const s = setup();
    const stop = watchHistoryTop(s.root, s.sentinel, s.load);
    s.intersect(false);
    expect(s.load).not.toHaveBeenCalled();
    s.intersect(true);
    expect(s.load).toHaveBeenCalledOnce();
    stop();
    s.root.scrollTop = 0;
    s.root.dispatchEvent(new Event("scroll"));
    s.intersect(true);
    expect(s.load).toHaveBeenCalledOnce();
    expect(s.disconnect).toHaveBeenCalledOnce();
  });

  it("rechecks when reattached after a page arrives while still at the top", () => {
    const s = setup(0);
    watchHistoryTop(s.root, s.sentinel, s.load)();
    const stop = watchHistoryTop(s.root, s.sentinel, s.load);
    expect(s.load).toHaveBeenCalledTimes(2);
    stop();
  });
});
