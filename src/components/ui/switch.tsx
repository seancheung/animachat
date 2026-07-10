"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/utils/cn";

const labelVariants = cva(
  "inline-flex select-none items-center gap-2 text-content-100 text-sm",
  {
    variants: {
      disabled: {
        true: "cursor-not-allowed opacity-40",
        false: "cursor-pointer",
      },
    },
    defaultVariants: {
      disabled: false,
    },
  },
);

const trackVariants = cva(
  cn(
    "relative inline-flex shrink-0 items-center rounded-full bg-base-400 p-0.5 transition-colors",
    "peer-checked:bg-primary-500",
    "peer-focus-visible:ring-3 peer-focus-visible:ring-primary-500/20",
    "[&>span]:rounded-full [&>span]:bg-white [&>span]:shadow-sm [&>span]:transition-transform",
  ),
  {
    variants: {
      size: {
        sm: "h-4 w-7 [&>span]:size-3 peer-checked:[&>span]:translate-x-3",
        md: "h-5 w-9 [&>span]:size-4 peer-checked:[&>span]:translate-x-4",
      },
    },
    defaultVariants: {
      size: "md",
    },
  },
);

export type SwitchProps = Omit<
  React.ComponentProps<"input">,
  | "type"
  | "size"
  | "value"
  | "defaultValue"
  | "checked"
  | "defaultChecked"
  | "onChange"
> &
  VariantProps<typeof labelVariants> &
  VariantProps<typeof trackVariants> & {
    value?: boolean | null;
    defaultValue?: boolean;
    onChange?: (value: boolean) => void;
    label?: React.ReactNode;
  };

export default function Switch({
  className,
  disabled,
  size,
  label,
  value,
  defaultValue,
  onChange,
  ...props
}: SwitchProps) {
  return (
    <label className={cn(labelVariants({ className, disabled }))}>
      <input
        type="checkbox"
        role="switch"
        aria-checked={value === null ? false : value}
        disabled={disabled ?? false}
        className="peer sr-only"
        {...props}
        checked={value === null ? false : value}
        defaultChecked={defaultValue}
        onChange={(e) => onChange?.(e.target.checked)}
      />
      <span className={cn(trackVariants({ size }))}>
        <span />
      </span>
      {label != null && <span>{label}</span>}
    </label>
  );
}
