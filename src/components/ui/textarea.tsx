"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/utils/cn";

const variants = cva(
  "block min-h-20 min-w-50 resize-y rounded-md border bg-base-100 px-3 py-2 text-content-100 text-sm outline-none transition-all",
  {
    variants: {
      error: {
        true: "border-error focus:ring-3 focus:ring-error/10",
        false:
          "border-base-400 focus:border-primary-500 focus:ring-3 focus:ring-primary-500/10",
      },
      disabled: {
        true: "resize-none opacity-40",
        false: "",
      },
    },
    defaultVariants: {
      error: false,
      disabled: false,
    },
  },
);

export type TextareaProps = Omit<
  React.ComponentProps<"textarea">,
  "value" | "defaultValue" | "onChange"
> &
  VariantProps<typeof variants> & {
    value?: string | null;
    defaultValue?: string;
    onChange?: (value: string) => void;
  };

export default function Textarea({
  error,
  className,
  disabled,
  value,
  defaultValue,
  onChange,
  ...props
}: TextareaProps) {
  return (
    <textarea
      {...props}
      className={cn(variants({ className, error, disabled }))}
      disabled={disabled}
      value={value === null ? "" : value}
      defaultValue={defaultValue}
      onChange={(e) => onChange?.(e.target.value)}
    />
  );
}
