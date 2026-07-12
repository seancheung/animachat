"use client";

import {
  arrow as arrowMiddleware,
  autoUpdate,
  FloatingArrow,
  FloatingPortal,
  flip,
  offset,
  type Placement,
  shift,
  useDismiss,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
  useRole,
  useTransitionStyles,
} from "@floating-ui/react";
import { Slot } from "@radix-ui/react-slot";
import { useRef, useState } from "react";
import { cn } from "@/utils/cn";

export type TooltipProps = {
  content: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  delay?: number;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  children: React.ReactNode;
  className?: string;
};

export default function Tooltip({
  content,
  side = "top",
  align = "center",
  delay = 200,
  open: controlledOpen,
  onOpenChange,
  disabled,
  children,
  className,
}: TooltipProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;
  const setOpen = (next: boolean) => {
    if (!isControlled) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };

  const arrowRef = useRef<SVGSVGElement>(null);

  const placement: Placement = align === "center" ? side : `${side}-${align}`;

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement,
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(8),
      flip({ padding: 8 }),
      shift({ padding: 8 }),
      arrowMiddleware({ element: arrowRef, padding: 6 }),
    ],
  });

  const hover = useHover(context, {
    move: false,
    enabled: !disabled,
    delay: { open: delay, close: 0 },
  });
  const focus = useFocus(context, { enabled: !disabled });
  const dismiss = useDismiss(context, { referencePress: true });
  const role = useRole(context, { role: "tooltip" });

  const { getReferenceProps, getFloatingProps } = useInteractions([
    hover,
    focus,
    dismiss,
    role,
  ]);

  const { isMounted, styles: transitionStyles } = useTransitionStyles(context, {
    duration: { open: 150, close: 100 },
    initial: { opacity: 0, transform: "scale(0.96)" },
    open: { opacity: 1, transform: "scale(1)" },
  });

  if (disabled || content == null || content === false) {
    return <>{children}</>;
  }

  return (
    <>
      <Slot ref={refs.setReference} {...getReferenceProps()}>
        {children}
      </Slot>
      {isMounted && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            className="pointer-events-none z-50"
            {...getFloatingProps()}
          >
            <div
              style={transitionStyles}
              className={cn(
                "relative max-w-xs rounded-md bg-content-100 px-2.5 py-1.5 text-base-100 text-xs shadow-(--shadow-overlay)",
                className,
              )}
            >
              {content}
              <FloatingArrow
                ref={arrowRef}
                context={context}
                width={10}
                height={5}
                className="fill-content-100"
              />
            </div>
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
