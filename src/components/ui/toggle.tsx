"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { createContext, useContext, useState } from "react";
import { cn } from "@/utils/cn";

type ToggleGroupContextValue = {
  value: unknown;
  setValue: (next: unknown) => void;
  cancelable: boolean;
  disabled?: boolean;
};

const ToggleGroupContext = createContext<ToggleGroupContextValue | null>(null);

const visualVariants = cva(
  cn(
    "has-icon inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-full border transition-colors",
    "border-base-400 bg-base-100 text-content-100",
    "peer-not-disabled:peer-not-checked:hover:bg-base-400",
    "peer-checked:border-(--active-color) peer-checked:bg-(--active-color)/10 peer-checked:text-(--active-color)",
    "peer-focus-visible:ring-(--active-color)/20 peer-focus-visible:ring-3",
  ),
  {
    variants: {
      variant: {
        default: "[--active-color:var(--color-primary-500)]",
        success: "[--active-color:var(--color-success)]",
        info: "[--active-color:var(--color-info)]",
        error: "[--active-color:var(--color-error)]",
      },
      size: {
        sm: "h-6 px-3 text-xs",
        md: "h-8 px-4 text-sm",
        lg: "h-9 px-5 text-base",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
    },
  },
);

export type ToggleProps = Omit<
  React.ComponentProps<"input">,
  | "type"
  | "size"
  | "value"
  | "defaultValue"
  | "checked"
  | "defaultChecked"
  | "onChange"
> &
  VariantProps<typeof visualVariants> & {
    value?: unknown;
    defaultValue?: boolean;
    onChange?: (selected: boolean) => void;
  };

export default function Toggle({
  className,
  children,
  variant,
  size,
  disabled,
  value,
  defaultValue,
  onChange,
  ...props
}: ToggleProps) {
  const group = useContext(ToggleGroupContext);
  const [uncontrolled, setUncontrolled] = useState(!!defaultValue);

  let selected: boolean;
  let isDisabled = disabled ?? false;
  let handleChange: (next: boolean) => void;

  if (group) {
    selected = group.value !== undefined && group.value === value;
    isDisabled = isDisabled || !!group.disabled;
    handleChange = (next) => {
      if (next) {
        group.setValue(value);
      } else if (group.cancelable) {
        group.setValue(undefined);
      }
    };
  } else {
    const isControlled = typeof value === "boolean";
    selected = isControlled ? (value as boolean) : uncontrolled;
    handleChange = (next) => {
      if (!isControlled) setUncontrolled(next);
      onChange?.(next);
    };
  }

  return (
    <label
      className={cn(
        "inline-flex",
        isDisabled ? "cursor-not-allowed opacity-40" : "cursor-pointer",
      )}
    >
      <input
        type="checkbox"
        className="peer sr-only"
        disabled={isDisabled}
        {...props}
        checked={selected}
        onChange={(e) => handleChange(e.target.checked)}
      />
      <span className={cn(visualVariants({ variant, size }), className)}>
        {children}
      </span>
    </label>
  );
}

export type ToggleGroupProps<T = unknown> = {
  value?: T | null;
  defaultValue?: T;
  onChange?: (value: T | undefined) => void;
  cancelable?: boolean;
  disabled?: boolean;
  className?: string;
  children?: React.ReactNode;
};

export function ToggleGroup<T = unknown>(props: ToggleGroupProps<T>) {
  const {
    defaultValue,
    onChange,
    cancelable = false,
    disabled,
    className,
    children,
  } = props;
  const isControlled = "value" in props;
  const [uncontrolled, setUncontrolled] = useState<T | undefined>(defaultValue);
  const current = isControlled ? props.value : uncontrolled;

  const setValue = (next: unknown) => {
    if (!isControlled) setUncontrolled(next as T | undefined);
    onChange?.(next as T | undefined);
  };

  return (
    <ToggleGroupContext.Provider
      value={{ value: current, setValue, cancelable, disabled }}
    >
      <div
        className={cn("inline-flex flex-wrap items-center gap-2", className)}
      >
        {children}
      </div>
    </ToggleGroupContext.Provider>
  );
}
