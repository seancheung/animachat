"use client";

/* eslint-disable react-hooks/refs -- Floating UI exposes callback refs through its refs object. */

import {
  autoUpdate,
  FloatingFocusManager,
  FloatingNode,
  FloatingPortal,
  flip,
  size as floatingSize,
  offset,
  safePolygon,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useFloatingNodeId,
  useFloatingTree,
  useHover,
  useInteractions,
  useListNavigation,
  useMergeRefs,
  useRole,
  useTransitionStyles,
} from "@floating-ui/react";
import { ChevronRightIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/utils/cn";

export type MenuItem =
  | {
      key?: string;
      label: React.ReactNode;
      icon?: React.ReactNode;
      shortcut?: React.ReactNode;
      onSelect?: () => void;
      disabled?: boolean;
      danger?: boolean;
      items?: MenuItem[];
    }
  | { type: "separator"; key?: string };

type MenuItemActionable = Extract<MenuItem, { label: React.ReactNode }>;
type MenuItemSubmenu = MenuItemActionable & { items: MenuItem[] };

export function isSeparator(
  item: MenuItem,
): item is Extract<MenuItem, { type: "separator" }> {
  return "type" in item && item.type === "separator";
}

export function hasSubmenu(item: MenuItem): item is MenuItemSubmenu {
  return !isSeparator(item) && Array.isArray(item.items) && item.items.length > 0;
}

export const menuPanelClass = cn(
  "flex min-w-40 flex-col overflow-y-auto rounded-md border border-base-200 bg-base-100 p-1 text-content-100 text-sm shadow-(--shadow-overlay)",
);

export const menuSizeMiddleware = () =>
  floatingSize({
    apply({ elements, availableHeight }) {
      Object.assign(elements.floating.style, {
        maxHeight: `${Math.max(availableHeight - 8, 0)}px`,
      });
    },
    padding: 8,
  });
export const menuPanelCompactClass = cn("min-w-30 p-0.5 text-xs");

export const menuItemClass = cn(
  "has-icon-3.5 flex h-7 icon:shrink-0 shrink-0 cursor-pointer items-center gap-2 rounded-sm px-2 outline-none transition-colors",
  "data-[active=true]:bg-base-300 data-[active=true]:text-content-100",
  "aria-disabled:cursor-not-allowed aria-disabled:opacity-40",
  "data-[danger=true]:text-error",
  "data-[danger=true]:data-[active=true]:bg-error/15 data-[danger=true]:data-[active=true]:text-error",
);
export const menuItemCompactClass = cn("h-6 px-1");

type GetItemProps = (
  userProps?: React.HTMLProps<HTMLElement>,
) => Record<string, unknown>;

export function MenuItems({
  items,
  compact,
  listRef,
  getItemProps,
  activeIndex,
  setActiveIndex,
  onSelect,
}: {
  items: MenuItem[];
  compact: boolean;
  listRef: React.RefObject<Array<HTMLElement | null>>;
  getItemProps: GetItemProps;
  activeIndex: number | null;
  setActiveIndex: (i: number | null) => void;
  onSelect: (item: MenuItemActionable) => void;
}) {
  return (
    <>
      {items.map((item, i) => {
        if (isSeparator(item)) {
          return <hr key={item.key ?? `sep-${i}`} className="my-1 h-px border-0 bg-base-200" />;
        }
        if (hasSubmenu(item)) {
          return (
            <SubMenuTrigger
              key={item.key ?? i}
              item={item}
              index={i}
              compact={compact}
              parentListRef={listRef}
              parentGetItemProps={getItemProps}
              parentActiveIndex={activeIndex}
              parentSetActiveIndex={setActiveIndex}
            />
          );
        }
        const active = activeIndex === i;
        return (
          <div
            key={item.key ?? i}
            ref={(el) => { listRef.current[i] = el; }}
            role="menuitem"
            tabIndex={active ? 0 : -1}
            aria-disabled={item.disabled || undefined}
            data-active={active}
            data-danger={item.danger || undefined}
            className={cn(menuItemClass, compact && menuItemCompactClass)}
            {...getItemProps({
              onClick() {
                if (!item.disabled) onSelect(item);
              },
              onKeyDown(event) {
                if (event.key === "Enter") {
                  event.preventDefault();
                  if (!item.disabled) onSelect(item);
                }
              },
            })}
          >
            {item.icon}
            <span className="flex-1 truncate">{item.label}</span>
            {item.shortcut && (
              <span className="ml-2 font-mono text-content-400 text-xs">{item.shortcut}</span>
            )}
          </div>
        );
      })}
    </>
  );
}

function SubMenuTrigger({
  item,
  index,
  compact,
  parentListRef,
  parentGetItemProps,
  parentActiveIndex,
  parentSetActiveIndex,
}: {
  item: MenuItemSubmenu;
  index: number;
  compact: boolean;
  parentListRef: React.MutableRefObject<Array<HTMLElement | null>>;
  parentGetItemProps: GetItemProps;
  parentActiveIndex: number | null;
  parentSetActiveIndex: (i: number | null) => void;
}) {
  const nodeId = useFloatingNodeId();
  const tree = useFloatingTree();
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const isParentActive = parentActiveIndex === index;

  const { refs, floatingStyles, context } = useFloating({
    nodeId,
    open: isOpen,
    onOpenChange: setIsOpen,
    placement: "right-start",
    middleware: [
      offset({ mainAxis: 4, alignmentAxis: -4 }),
      flip({ padding: 8 }),
      shift({ padding: 8 }),
      menuSizeMiddleware(),
    ],
    whileElementsMounted: autoUpdate,
  });

  const hover = useHover(context, {
    enabled: !item.disabled,
    delay: { open: 75 },
    handleClose: safePolygon({ blockPointerEvents: false }),
  });
  const click = useClick(context, { event: "mousedown", toggle: false, ignoreMouse: true });
  const dismiss = useDismiss(context, { bubbles: true });
  const role = useRole(context, { role: "menu" });
  const listRef = useRef<Array<HTMLElement | null>>([]);
  const listNav = useListNavigation(context, {
    listRef,
    activeIndex,
    onNavigate: setActiveIndex,
    nested: true,
    loop: true,
    focusItemOnOpen: "auto",
  });
  const { getReferenceProps, getFloatingProps, getItemProps } = useInteractions(
    [hover, click, dismiss, role, listNav],
  );

  useEffect(() => {
    if (!tree) return;
    function onTreeClick() { setIsOpen(false); }
    tree.events.on("click", onTreeClick);
    return () => { tree.events.off("click", onTreeClick); };
  }, [tree]);

  const { isMounted, styles: transitionStyles } = useTransitionStyles(context, {
    duration: { open: 150, close: 100 },
    initial: { opacity: 0, transform: "scale(0.96) translateX(-4px)" },
    open: { opacity: 1, transform: "scale(1) translateX(0)" },
  });
  const setRef = useMergeRefs([
    refs.setReference,
    (el: HTMLElement | null) => { parentListRef.current[index] = el; },
  ]);

  return (
    <FloatingNode id={nodeId}>
      <div
        ref={setRef}
        role="menuitem"
        tabIndex={isParentActive ? 0 : -1}
        aria-disabled={item.disabled || undefined}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        data-active={isParentActive || isOpen}
        data-danger={item.danger || undefined}
        className={cn(menuItemClass, compact && menuItemCompactClass)}
        {...parentGetItemProps(getReferenceProps({
          onKeyDown(event) {
            if (event.key === "ArrowRight" || event.key === "Enter") {
              event.preventDefault();
              parentSetActiveIndex(index);
              setIsOpen(true);
            }
          },
        }))}
      >
        {item.icon}
        <span className="flex-1 truncate">{item.label}</span>
        <ChevronRightIcon className="-mr-1 ml-2 size-3.5 text-content-400" />
      </div>
      {isMounted && (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false} initialFocus={-1}>
            <div
              ref={refs.setFloating}
              style={floatingStyles}
              className="z-50 outline-none"
              {...getFloatingProps()}
            >
              <div
                style={{ ...transitionStyles, maxHeight: "inherit" }}
                className={cn(menuPanelClass, compact && menuPanelCompactClass)}
              >
                <MenuItems
                  items={item.items}
                  compact={compact}
                  listRef={listRef}
                  getItemProps={getItemProps}
                  activeIndex={activeIndex}
                  setActiveIndex={setActiveIndex}
                  onSelect={(selected) => {
                    if (selected.disabled) return;
                    selected.onSelect?.();
                    tree?.events.emit("click");
                  }}
                />
              </div>
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </FloatingNode>
  );
}
