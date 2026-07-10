"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { CheckIcon } from "lucide-react";
import { cn } from "@/utils/cn";

const variants = cva(
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

export type CheckboxProps = Omit<
  React.ComponentProps<"input">,
  "type" | "value" | "defaultValue" | "checked" | "defaultChecked" | "onChange"
> &
  VariantProps<typeof variants> & {
    value?: boolean | null;
    defaultValue?: boolean;
    onChange?: (value: boolean) => void;
    label?: React.ReactNode;
  };

export default function Checkbox({
  className,
  disabled,
  label,
  value,
  defaultValue,
  onChange,
  ...props
}: CheckboxProps) {
  return (
    <label className={cn(variants({ className, disabled }))}>
      <input
        type="checkbox"
        disabled={disabled}
        aria-checked={value === null ? false : value}
        className="peer sr-only"
        {...props}
        checked={value === null ? false : value}
        defaultChecked={defaultValue}
        onChange={(e) => onChange?.(e.target.checked)}
      />
      <span
        className={cn(
          "inline-flex size-3.5 shrink-0 items-center justify-center rounded-sm border border-base-400 bg-base-100 transition-colors",
          "peer-checked:border-primary-500 peer-checked:bg-primary-500",
          "peer-focus-visible:ring-3 peer-focus-visible:ring-primary-500/20",
          "has-icon-3 icon:scale-0 icon:text-primary-content icon:transition-transform peer-checked:icon:scale-100",
        )}
      >
        <CheckIcon strokeWidth={3} />
      </span>
      {label != null && <span>{label}</span>}
    </label>
  );
}
