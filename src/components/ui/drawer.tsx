"use client";

import {
  FloatingFocusManager,
  FloatingOverlay,
  FloatingPortal,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
  useTransitionStyles,
} from "@floating-ui/react";
import { cva, type VariantProps } from "class-variance-authority";
import { XIcon } from "lucide-react";
import { useId } from "react";
import { cn } from "@/utils/cn";
import Button from "./button";

const contentVariants = cva(
  "fixed flex max-h-full max-w-full flex-col border-base-200 bg-base-100 shadow-(--shadow-overlay) outline-none",
  {
    variants: {
      side: {
        left: "top-0 bottom-0 left-0 border-r",
        right: "top-0 right-0 bottom-0 border-l",
        top: "top-0 right-0 left-0 border-b",
        bottom: "right-0 bottom-0 left-0 border-t",
      },
      size: {
        sm: "",
        md: "",
        lg: "",
      },
    },
    compoundVariants: [
      { side: ["left", "right"], size: "sm", class: "w-80" },
      { side: ["left", "right"], size: "md", class: "w-100" },
      { side: ["left", "right"], size: "lg", class: "w-130" },
      { side: ["top", "bottom"], size: "sm", class: "h-50" },
      { side: ["top", "bottom"], size: "md", class: "h-80" },
      { side: ["top", "bottom"], size: "lg", class: "h-120" },
    ],
    defaultVariants: {
      side: "right",
      size: "md",
    },
  },
);

function getInitialTransform(side: "left" | "right" | "top" | "bottom") {
  switch (side) {
    case "left":
      return "translateX(-100%)";
    case "right":
      return "translateX(100%)";
    case "top":
      return "translateY(-100%)";
    case "bottom":
      return "translateY(100%)";
  }
}

export type DrawerProps = VariantProps<typeof contentVariants> & {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  footer?: React.ReactNode;
  children?: React.ReactNode;
  closable?: boolean;
  className?: string;
};

export default function Drawer({
  open = false,
  onOpenChange,
  title,
  description,
  footer,
  children,
  closable = true,
  side,
  size,
  className,
}: DrawerProps) {
  const titleId = useId();
  const descId = useId();
  const sideKey = side ?? "right";

  const { refs, context } = useFloating({
    open,
    onOpenChange,
  });

  const dismiss = useDismiss(context, {
    escapeKey: closable,
    // a press inside another floating portal (e.g. a confirm dialog stacked
    // on top of this drawer) must not dismiss this overlay
    outsidePress: closable
      ? (event) => {
          const portal = (event.target as Element | null)?.closest?.(
            "[data-floating-ui-portal]",
          );
          return !portal || portal.contains(refs.floating.current);
        }
      : false,
  });
  const role = useRole(context);

  const { getFloatingProps } = useInteractions([dismiss, role]);

  const offscreen = getInitialTransform(sideKey);
  const { isMounted, styles: contentStyles } = useTransitionStyles(context, {
    duration: { open: 250, close: 200 },
    initial: { transform: offscreen },
    open: { transform: "translate(0, 0)" },
    close: { transform: offscreen },
  });
  const { styles: overlayStyles } = useTransitionStyles(context, {
    duration: { open: 200, close: 150 },
    initial: { opacity: 0 },
    open: { opacity: 1 },
    close: { opacity: 0 },
  });

  if (!isMounted) return null;

  const hasHeader = !!title || !!description || closable;

  return (
    <FloatingPortal>
      <FloatingOverlay
        lockScroll
        style={overlayStyles}
        className="z-50 bg-black/60"
      >
        <FloatingFocusManager context={context}>
          <div
            ref={refs.setFloating}
            style={contentStyles}
            className={cn(contentVariants({ side, size }), className)}
            aria-labelledby={title ? titleId : undefined}
            aria-describedby={description ? descId : undefined}
            {...getFloatingProps()}
          >
            {hasHeader && (
              <div className="relative shrink-0 border-base-200 border-b p-4">
                {closable && (
                  <Button
                    variant="ghost"
                    size="sm"
                    shape="circle"
                    onClick={() => onOpenChange?.(false)}
                    aria-label="Close"
                    className="absolute top-3 right-3"
                  >
                    <XIcon />
                  </Button>
                )}
                {title && (
                  <h2
                    id={titleId}
                    className="pr-8 font-semibold text-content-100 text-xl"
                  >
                    {title}
                  </h2>
                )}
                {description && (
                  <p id={descId} className="mt-1.5 text-content-300 text-sm">
                    {description}
                  </p>
                )}
              </div>
            )}
            {children && (
              <div className="flex-1 overflow-y-auto p-4 text-content-100 text-sm">
                {children}
              </div>
            )}
            {footer && (
              <div className="flex shrink-0 justify-end gap-2 border-base-200 border-t p-4">
                {footer}
              </div>
            )}
          </div>
        </FloatingFocusManager>
      </FloatingOverlay>
    </FloatingPortal>
  );
}
