"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { ChevronDownIcon, ChevronUpIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/utils/cn";

const variants = cva(
  "group inline-flex min-w-24 items-center justify-center gap-1.5 rounded-md border bg-base-100 text-content-100 transition-all",
  {
    variants: {
      size: {
        sm: "h-6 px-2 text-xs",
        md: "h-8 px-3 text-sm",
        lg: "h-9 px-3.5 text-base",
      },
      error: {
        true: "border-error focus-within:ring-3 focus-within:ring-error/10",
        false:
          "border-base-400 focus-within:border-primary-500 focus-within:ring-3 focus-within:ring-ring/10",
      },
      disabled: {
        true: "opacity-40",
        false: "",
      },
    },
    defaultVariants: {
      size: "md",
      error: false,
      disabled: false,
    },
  },
);

export type InputNumberProps = Omit<
  React.ComponentProps<"input">,
  "type" | "value" | "defaultValue" | "onChange" | "size" | "min" | "max"
> &
  VariantProps<typeof variants> & {
    value?: number | null;
    defaultValue?: number;
    onChange?: (value: number) => void;
    min?: number;
    max?: number;
    step?: number;
    clearable?: boolean;
    onClear?: () => void;
    integer?: boolean;
  };

export default function InputNumber({
  error,
  className,
  size,
  disabled,
  value,
  defaultValue,
  onChange,
  min,
  max,
  step = 1,
  clearable = false,
  onClear,
  integer = false,
  onBlur,
  onKeyDown,
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

  function clamp(num: number) {
    let next = num;
    if (min !== undefined) next = Math.max(min, next);
    if (max !== undefined) next = Math.min(max, next);
    return next;
  }

  function revert() {
    setText(isControlled ? externalText : lastCommittedRef.current);
  }

  function commitNumber(num: number) {
    const next = String(num);
    setText(next);
    if (next === lastCommittedRef.current) return;
    lastCommittedRef.current = next;
    onChange?.(num);
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
    commitNumber(clamp(num));
  }

  const currentNumber = () => {
    const parsed = Number(text);
    if (text !== "" && !Number.isNaN(parsed)) return parsed;
    const committed = Number(lastCommittedRef.current);
    if (lastCommittedRef.current !== "" && !Number.isNaN(committed)) {
      return committed;
    }
    return null;
  };

  function stepBy(delta: number) {
    if (disabled) return;
    const base = currentNumber();
    // Round away float drift like 1.6 + 0.1 === 1.7000000000000002
    const next =
      base === null
        ? clamp(min ?? 0)
        : clamp(Number((base + delta * step).toFixed(10)));
    commitNumber(integer ? Math.round(next) : next);
  }

  const current = currentNumber();
  const atMin = min !== undefined && current !== null && current <= min;
  const atMax = max !== undefined && current !== null && current >= max;

  const showClear = clearable && !disabled && text !== "";

  function handleClear() {
    onClear?.();
    lastCommittedRef.current = "";
    if (!isControlled) setText("");
  }

  const stepButton =
    "flex flex-1 cursor-pointer items-center justify-center px-1 text-content-400 outline-none transition-colors hover:bg-base-300 hover:text-content-200 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent";

  return (
    <div className={cn(variants({ className, size, error, disabled }))}>
      <input
        type="text"
        inputMode={integer ? "numeric" : "decimal"}
        disabled={disabled ?? false}
        className={cn("w-0 flex-1 border-none bg-transparent outline-none")}
        {...props}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => {
          commit(e.target.value);
          onBlur?.(e);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp") {
            e.preventDefault();
            stepBy(1);
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            stepBy(-1);
          }
          onKeyDown?.(e);
        }}
      />
      {showClear && (
        <button
          type="button"
          tabIndex={-1}
          aria-label="Clear"
          onMouseDown={(e) => e.preventDefault()}
          onClick={handleClear}
          className="has-icon-3.5 inline-flex shrink-0 cursor-pointer items-center justify-center rounded-sm text-content-400 opacity-0 transition hover:text-content-200 group-focus-within:opacity-100 group-hover:opacity-100"
        >
          <XIcon />
        </button>
      )}
      <div
        className={cn(
          "flex flex-col self-stretch overflow-hidden rounded-r-[calc(var(--radius-md)-1px)] border-base-400 border-l opacity-0 transition-opacity",
          size === "sm" ? "-mr-2" : size === "lg" ? "-mr-3.5" : "-mr-3",
          !disabled && "group-focus-within:opacity-100 group-hover:opacity-100",
        )}
      >
        <button
          type="button"
          tabIndex={-1}
          aria-label="Increase"
          disabled={(disabled ?? false) || atMax}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => stepBy(1)}
          className={stepButton}
        >
          <ChevronUpIcon className="size-3" />
        </button>
        <button
          type="button"
          tabIndex={-1}
          aria-label="Decrease"
          disabled={(disabled ?? false) || atMin}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => stepBy(-1)}
          className={cn(stepButton, "border-base-400 border-t")}
        >
          <ChevronDownIcon className="size-3" />
        </button>
      </div>
    </div>
  );
}
