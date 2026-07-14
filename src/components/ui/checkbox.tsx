"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { CheckIcon, MinusIcon } from "lucide-react";
import { cn } from "@/utils/cn";

// relative: anchor the sr-only input to the label — unanchored it escapes unpositioned
// scroll containers, and focusing it can scroll a dialog overlay right off the screen
const variants = cva(
  "relative inline-flex select-none items-center gap-2 text-content-100",
  {
    variants: {
      size: {
        sm: "text-xs",
        md: "text-sm",
        lg: "text-base",
      },
      disabled: {
        true: "cursor-not-allowed opacity-40",
        false: "cursor-pointer",
      },
    },
    defaultVariants: {
      size: "md",
      disabled: false,
    },
  },
);

const boxSizes = {
  sm: "size-3 has-icon-2.5",
  md: "size-3.5 has-icon-3",
  lg: "size-4 has-icon-3.5",
} as const;

export type CheckboxProps = Omit<
  React.ComponentProps<"input">,
  | "type"
  | "value"
  | "defaultValue"
  | "checked"
  | "defaultChecked"
  | "onChange"
  | "size"
> &
  VariantProps<typeof variants> & {
    value?: boolean | null;
    defaultValue?: boolean;
    onChange?: (value: boolean) => void;
    /** Display-only mixed state; value stays boolean (conventionally false) */
    indeterminate?: boolean;
    label?: React.ReactNode;
  };

export default function Checkbox({
  className,
  size,
  disabled,
  label,
  value,
  defaultValue,
  onChange,
  indeterminate = false,
  ...props
}: CheckboxProps) {
  return (
    <label className={cn(variants({ className, size, disabled }))}>
      <input
        type="checkbox"
        disabled={disabled}
        aria-checked={indeterminate ? "mixed" : value === null ? false : value}
        className="peer sr-only"
        {...props}
        ref={(el) => {
          if (el) el.indeterminate = indeterminate;
        }}
        checked={value === null ? false : value}
        defaultChecked={defaultValue}
        onChange={(e) => onChange?.(e.target.checked)}
      />
      <span
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-sm border border-base-400 bg-base-100 transition-colors",
          "peer-checked:border-primary-500 peer-checked:bg-primary-500",
          "peer-focus-visible:ring-3 peer-focus-visible:ring-ring/20",
          "icon:scale-0 icon:text-primary-content icon:transition-transform peer-checked:icon:scale-100",
          indeterminate && "icon:scale-100 border-primary-500 bg-primary-500",
          boxSizes[size ?? "md"],
        )}
      >
        {indeterminate ? (
          <MinusIcon strokeWidth={3} />
        ) : (
          <CheckIcon strokeWidth={3} />
        )}
      </span>
      {label != null && <span>{label}</span>}
    </label>
  );
}
