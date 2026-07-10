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
  "relative flex max-h-[calc(100vh-2rem)] w-full flex-col rounded-lg border border-base-200 bg-base-100 p-6 shadow-lg outline-none",
  {
    variants: {
      size: {
        sm: "max-w-100",
        md: "max-w-130",
        lg: "max-w-170",
      },
    },
    defaultVariants: {
      size: "md",
    },
  },
);

export type DialogProps = VariantProps<typeof contentVariants> & {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  footer?: React.ReactNode;
  children?: React.ReactNode;
  closable?: boolean;
  className?: string;
};

export default function Dialog({
  open = false,
  onOpenChange,
  title,
  description,
  footer,
  children,
  closable = true,
  size,
  className,
}: DialogProps) {
  const titleId = useId();
  const descId = useId();

  const { refs, context } = useFloating({
    open,
    onOpenChange,
  });

  const dismiss = useDismiss(context, {
    escapeKey: closable,
    // a press inside another floating portal (e.g. a confirm dialog stacked
    // on top of this one) must not dismiss this overlay
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

  const { isMounted, styles: contentStyles } = useTransitionStyles(context, {
    duration: { open: 200, close: 150 },
    initial: { opacity: 0, transform: "scale(0.96)" },
    open: { opacity: 1, transform: "scale(1)" },
  });

  const { styles: overlayStyles } = useTransitionStyles(context, {
    duration: { open: 200, close: 150 },
    initial: { opacity: 0 },
    open: { opacity: 1 },
  });

  if (!isMounted) return null;

  return (
    <FloatingPortal>
      <FloatingOverlay
        lockScroll
        style={{ ...overlayStyles, overflow: "hidden" }}
        className="z-50 grid place-items-center bg-black/60 p-4"
      >
        <FloatingFocusManager context={context}>
          <div
            ref={refs.setFloating}
            style={contentStyles}
            className={cn(contentVariants({ size, className }))}
            aria-labelledby={title ? titleId : undefined}
            aria-describedby={description ? descId : undefined}
            {...getFloatingProps()}
          >
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
            {children && (
              <div
                className={cn(
                  "min-h-0 overflow-y-auto text-content-100 text-sm",
                  (title || description) && "mt-4",
                )}
              >
                {children}
              </div>
            )}
            {footer && (
              <div className="mt-6 flex justify-end gap-2">{footer}</div>
            )}
          </div>
        </FloatingFocusManager>
      </FloatingOverlay>
    </FloatingPortal>
  );
}
