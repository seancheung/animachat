"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { useState } from "react";

const variants = cva(
  "has-icon inline-flex h-8 min-w-50 items-center justify-center gap-1.5 rounded-md border bg-base-100 px-3 icon:text-content-400 text-content-100 text-sm transition-all",
  {
    variants: {
      error: {
        true: "border-error focus-within:ring-3 focus-within:ring-error/10",
        false:
          "border-base-400 focus-within:border-primary-500 focus-within:ring-3 focus-within:ring-primary-500/10",
      },
      disabled: {
        true: "opacity-40",
        false: "",
      },
    },
    defaultVariants: {
      error: false,
      disabled: false,
    },
  },
);

export type InputPasswordProps = Omit<
  React.ComponentProps<"input">,
  "type" | "value" | "defaultValue" | "onChange"
> &
  VariantProps<typeof variants> & {
    value?: string | null;
    defaultValue?: string;
    icon?: React.ReactNode;
    onChange?: (value: string) => void;
  };

export default function InputPassword({
  error,
  icon,
  className,
  disabled,
  value,
  defaultValue,
  onChange,
  ...props
}: InputPasswordProps) {
  const [visible, setVisible] = useState(false);
  return (
    <div className={variants({ className, error, disabled })}>
      {icon}
      <input
        {...props}
        type={visible ? "text" : "password"}
        disabled={disabled}
        className="w-full min-w-0 flex-1 border-none bg-transparent outline-none"
        value={value === null ? "" : value}
        defaultValue={defaultValue}
        onChange={(e) => onChange?.(e.target.value)}
      />
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled ?? false}
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        className="has-icon -mr-1 inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-sm text-content-400 transition-colors not-disabled:hover:text-content-200"
      >
        {visible ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  );
}
