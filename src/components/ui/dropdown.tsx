"use client";

/* eslint-disable react-hooks/refs -- Floating UI exposes callback refs through its refs object. */

import {
  autoUpdate,
  FloatingFocusManager,
  FloatingNode,
  FloatingPortal,
  FloatingTree,
  flip,
  offset,
  type Placement,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useFloatingNodeId,
  useFloatingTree,
  useInteractions,
  useListNavigation,
  useRole,
  useTransitionStyles,
} from "@floating-ui/react";
import { Slot } from "@radix-ui/react-slot";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/utils/cn";
import {
  type MenuItem,
  MenuItems,
  menuPanelClass,
  menuPanelCompactClass,
  menuSizeMiddleware,
} from "./menu";

export type DropdownItem = MenuItem;

export type DropdownProps = {
  items: MenuItem[];
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  compact?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
  className?: string;
};

export default function Dropdown(props: DropdownProps) {
  return <FloatingTree><DropdownInner {...props} /></FloatingTree>;
}

function DropdownInner({
  items,
  side = "bottom",
  align = "start",
  compact = false,
  open: controlledOpen,
  onOpenChange,
  children,
  className,
}: DropdownProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;
  const setOpen = (next: boolean) => {
    if (!isControlled) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const placement: Placement = align === "center" ? side : `${side}-${align}`;
  const nodeId = useFloatingNodeId();
  const tree = useFloatingTree();
  const { refs, floatingStyles, context } = useFloating({
    nodeId,
    open,
    onOpenChange: setOpen,
    placement,
    whileElementsMounted: autoUpdate,
    middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 }), menuSizeMiddleware()],
  });
  const listRef = useRef<Array<HTMLElement | null>>([]);
  const click = useClick(context, { event: "mousedown" });
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: "menu" });
  const listNav = useListNavigation(context, {
    listRef,
    activeIndex,
    onNavigate: setActiveIndex,
    loop: true,
    focusItemOnOpen: false,
  });
  const { getReferenceProps, getFloatingProps, getItemProps } = useInteractions(
    [click, dismiss, role, listNav],
  );
  const closeRef = useRef(() => { setOpen(false); setActiveIndex(null); });
  closeRef.current = () => { setOpen(false); setActiveIndex(null); };

  useEffect(() => {
    if (!tree) return;
    const handler = () => closeRef.current();
    tree.events.on("click", handler);
    return () => { tree.events.off("click", handler); };
  }, [tree]);

  const isAbove = placement.startsWith("top");
  const { isMounted, styles: transitionStyles } = useTransitionStyles(context, {
    duration: { open: 150, close: 100 },
    initial: { opacity: 0, transform: `scale(0.96) translateY(${isAbove ? 4 : -4}px)` },
    open: { opacity: 1, transform: "scale(1) translateY(0)" },
  });

  return (
    <>
      <Slot ref={refs.setReference} {...getReferenceProps()}>{children}</Slot>
      <FloatingNode id={nodeId}>
        {isMounted && (
          <FloatingPortal>
            <FloatingFocusManager context={context} modal={false}>
              <div
                ref={refs.setFloating}
                style={floatingStyles}
                className={cn("z-50 outline-none", isAbove ? "origin-bottom" : "origin-top")}
                {...getFloatingProps()}
              >
                <div
                  style={{ ...transitionStyles, maxHeight: "inherit" }}
                  className={cn(menuPanelClass, compact && menuPanelCompactClass, className)}
                >
                  <MenuItems
                    items={items}
                    compact={compact}
                    listRef={listRef}
                    getItemProps={getItemProps}
                    activeIndex={activeIndex}
                    setActiveIndex={setActiveIndex}
                    onSelect={(item) => {
                      if (item.disabled) return;
                      item.onSelect?.();
                      tree?.events.emit("click");
                    }}
                  />
                </div>
              </div>
            </FloatingFocusManager>
          </FloatingPortal>
        )}
      </FloatingNode>
    </>
  );
}
