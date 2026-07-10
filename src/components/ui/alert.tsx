"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { CheckIcon, XIcon } from "lucide-react";
import { cn } from "@/utils/cn";

const variants = cva(
  "flex items-start gap-3 rounded-md border px-4 py-3 text-sm",
  {
    variants: {
      variant: {
        success: "border-success/25 bg-success/10",
        warning: "border-warning/25 bg-warning/10",
        error: "border-error/25 bg-error/10",
        info: "border-info/25 bg-info/10",
      },
    },
    defaultVariants: {
      variant: "info",
    },
  },
);

const badgeVariants = cva(
  "has-icon-3 mt-px inline-flex size-4 shrink-0 items-center justify-center rounded-full icon:stroke-3",
  {
    variants: {
      variant: {
        success: "bg-success text-success-content",
        warning: "bg-warning text-warning-content",
        error: "bg-error text-error-content",
        info: "bg-info text-info-content",
      },
    },
    defaultVariants: {
      variant: "info",
    },
  },
);

const ICONS = {
  success: CheckIcon,
  warning: () => <b>!</b>,
  error: XIcon,
  info: () => <b>i</b>,
} as const;

export type AlertProps = React.ComponentProps<"div"> &
  VariantProps<typeof variants> & {
    title?: React.ReactNode;
    icon?: React.ReactNode;
  };

export default function Alert({
  className,
  variant,
  title,
  icon,
  children,
  ...props
}: AlertProps) {
  const Icon = ICONS[variant ?? "info"];
  return (
    <div className={cn(variants({ className, variant }))} {...props}>
      <span className={cn(badgeVariants({ variant }))}>{icon ?? <Icon />}</span>
      <div className="min-w-0 flex-1">
        {title && (
          <div className="mb-0.5 font-semibold text-content-100">{title}</div>
        )}
        {children && <div className="text-content-100">{children}</div>}
      </div>
    </div>
  );
}
