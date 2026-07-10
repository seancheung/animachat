"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/utils/cn";

const variants = cva(
  "inline-flex h-8 min-w-24 items-center justify-center gap-1.5 rounded-md border bg-base-100 px-3 text-content-100 text-sm transition-all",
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

export type InputNumberProps = Omit<
  React.ComponentProps<"input">,
  "type" | "value" | "defaultValue" | "onChange"
> &
  VariantProps<typeof variants> & {
    value?: number | null;
    defaultValue?: number;
    onChange?: (value: number) => void;
    clearable?: boolean;
    onClear?: () => void;
    integer?: boolean;
  };

export default function InputNumber({
  error,
  className,
  disabled,
  value,
  defaultValue,
  onChange,
  clearable = false,
  onClear,
  integer = false,
  onBlur,
  ...props
}: InputNumberProps) {
  const isControlled = value !== undefined;
  const externalText =
    value === null || value === undefined ? "" : String(value);

  const initialText = isControlled
    ? externalText
    : defaultValue !== undefined
      ? String(defaultValue)
      : "";
  const [text, setText] = useState<string>(initialText);
  const lastCommittedRef = useRef<string>(initialText);

  useEffect(() => {
    if (!isControlled) return;
    const next = value === null || value === undefined ? "" : String(value);
    setText(next);
    lastCommittedRef.current = next;
  }, [isControlled, value]);

  function revert() {
    setText(isControlled ? externalText : lastCommittedRef.current);
  }

  function commit(raw: string) {
    if (raw === "") {
      if (clearable) {
        onClear?.();
        lastCommittedRef.current = "";
        if (!isControlled) setText("");
        return;
      }
      revert();
      return;
    }
    const num = Number(raw);
    if (Number.isNaN(num) || (integer && !Number.isInteger(num))) {
      revert();
      return;
    }
    const next = String(num);
    setText(next);
    if (next === lastCommittedRef.current) return;
    lastCommittedRef.current = next;
    onChange?.(num);
  }

  return (
    <div className={cn(variants({ className, error, disabled }))}>
      <input
        type="text"
        inputMode={integer ? "numeric" : "decimal"}
        disabled={disabled}
        className={cn(
          "w-full min-w-0 flex-1 border-none bg-transparent outline-none",
        )}
        {...props}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => {
          commit(e.target.value);
          onBlur?.(e);
        }}
      />
    </div>
  );
}
