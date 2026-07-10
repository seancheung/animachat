"use client";

import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/utils/cn";

const variants = cva(
  "has-icon inline-flex items-center justify-center gap-1 whitespace-nowrap px-1.5 py-0.5",
  {
    variants: {
      variant: {
        primary:
          "[--bg-color:var(--color-primary-500)] [--fg-color:var(--color-primary-content)]",
        secondary:
          "[--bg-color:var(--color-base-400)] [--fg-color:var(--color-content-300)]",
        success:
          "[--bg-color:var(--color-success)] [--fg-color:var(--color-success-content)]",
        info: "[--bg-color:var(--color-info)] [--fg-color:var(--color-info-content)]",
        warning:
          "[--bg-color:var(--color-warning)] [--fg-color:var(--color-warning-content)]",
        error:
          "[--bg-color:var(--color-error)] [--fg-color:var(--color-error-content)]",
      },
      size: {
        md: "text-xs",
        sm: "text-tiny",
      },
      bordered: {
        true: "border border-(--bg-color)/25",
        false: "",
      },
      rounded: {
        true: "rounded-full",
        false: "rounded-md",
      },
      opaque: {
        true: "bg-(--bg-color) text-(--fg-color)",
        false: "bg-(--bg-color)/8 text-(--bg-color)",
      },
    },
    compoundVariants: [
      {
        opaque: false,
        variant: "secondary",
        className: "bg-(--bg-color) text-(--fg-color)",
      },
      {
        bordered: true,
        variant: "secondary",
        className: "border-(--fg-color)/25",
      },
    ],
    defaultVariants: {
      variant: "primary",
      size: "md",
      bordered: false,
      rounded: false,
      opaque: false,
    },
  },
);

export type BadgeProps = React.ComponentProps<"span"> &
  VariantProps<typeof variants> & {
    asChild?: boolean;
  };

export default function Badge({
  className,
  variant,
  size,
  bordered,
  rounded,
  opaque,
  asChild,
  ...props
}: BadgeProps) {
  const Comp = asChild ? Slot : "span";
  return (
    <Comp
      className={cn(
        variants({ className, variant, size, bordered, rounded, opaque }),
      )}
      {...props}
    />
  );
}
