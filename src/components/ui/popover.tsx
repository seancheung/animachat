"use client";

import {
  arrow as arrowMiddleware,
  autoUpdate,
  FloatingArrow,
  FloatingFocusManager,
  FloatingPortal,
  flip,
  offset,
  type Placement,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
  useTransitionStyles,
} from "@floating-ui/react";
import { Slot } from "@radix-ui/react-slot";
import { useRef, useState } from "react";
import { cn } from "@/utils/cn";

export type PopoverProps = {
  content: React.ReactNode | ((ctx: { close: () => void }) => React.ReactNode);
  title?: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  arrow?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  children: React.ReactNode;
  className?: string;
};

export default function Popover({
  content,
  title,
  side = "bottom",
  align = "center",
  arrow = false,
  open: controlledOpen,
  onOpenChange,
  disabled,
  children,
  className,
}: PopoverProps) {
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
      ...(arrow ? [arrowMiddleware({ element: arrowRef, padding: 6 })] : []),
    ],
  });

  const click = useClick(context, { enabled: !disabled });
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: "dialog" });

  const { getReferenceProps, getFloatingProps } = useInteractions([
    click,
    dismiss,
    role,
  ]);

  const { isMounted, styles: transitionStyles } = useTransitionStyles(context, {
    duration: { open: 150, close: 100 },
    initial: { opacity: 0, transform: "scale(0.96)" },
    open: { opacity: 1, transform: "scale(1)" },
  });

  return (
    <>
      <Slot ref={refs.setReference} {...getReferenceProps()}>
        {children}
      </Slot>
      {isMounted && !disabled && (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false}>
            <div
              ref={refs.setFloating}
              style={floatingStyles}
              className="z-50 outline-none"
              {...getFloatingProps()}
            >
              <div
                style={transitionStyles}
                className={cn(
                  "relative w-72 rounded-md border border-base-400 bg-base-100 p-3 text-content-100 text-sm shadow-(--shadow-overlay)",
                  className,
                )}
              >
                {title != null && (
                  <div className="mb-1 font-semibold">{title}</div>
                )}
                <div className="text-content-200">
                  {typeof content === "function"
                    ? content({ close: () => setOpen(false) })
                    : content}
                </div>
                {arrow && (
                  <FloatingArrow
                    ref={arrowRef}
                    context={context}
                    width={12}
                    height={6}
                    strokeWidth={1}
                    stroke="var(--color-base-400)"
                    className="fill-base-100"
                  />
                )}
              </div>
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </>
  );
}
