"use client";

import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/utils/cn";

const variants = cva(
  "has-icon inline-flex not-disabled:cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap border border-transparent font-medium transition-colors disabled:opacity-40",
  {
    variants: {
      variant: {
        primary:
          "bg-primary-500 text-primary-content not-disabled:hover:bg-primary-400 not-disabled:active:bg-primary-600",
        secondary:
          "border-base-400 bg-base-100 text-content-100 not-disabled:hover:bg-base-300 not-disabled:active:bg-base-400/50",
        ghost:
          "bg-transparent text-content-100 not-disabled:hover:bg-base-300 not-disabled:hover:text-content-100 not-disabled:active:bg-base-400/50",
        danger:
          "border-error/40 bg-transparent text-error not-disabled:hover:border-error not-disabled:hover:bg-error/10 not-disabled:active:bg-error/20",
      },
      size: {
        lg: "text-base",
        md: "text-sm",
        sm: "text-xs",
      },
      shape: {
        normal: "rounded-md",
        circle: "rounded-full",
        square: "rounded-md",
      },
    },
    compoundVariants: [
      {
        shape: "normal",
        size: "lg",
        className: "h-9 px-5",
      },
      {
        shape: "normal",
        size: "md",
        className: "h-8 px-4",
      },
      {
        shape: "normal",
        size: "sm",
        className: "h-6 px-3",
      },
      {
        shape: ["square", "circle"],
        size: "lg",
        className: "size-9",
      },
      {
        shape: ["square", "circle"],
        size: "md",
        className: "size-8",
      },
      {
        shape: ["square", "circle"],
        size: "sm",
        className: "size-6",
      },
    ],
    defaultVariants: {
      variant: "primary",
      size: "md",
      shape: "normal",
    },
  },
);

export type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof variants> & {
    asChild?: boolean;
  };

export default function Button({
  className,
  variant,
  size,
  shape,
  asChild,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      className={cn(variants({ className, variant, size, shape }))}
      {...props}
    />
  );
}
