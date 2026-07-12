"use client";

import { cva, type VariantProps } from "class-variance-authority";

const variants = cva(
  "not-disabled:cursor-pointer appearance-none rounded-xs bg-base-400 outline-none disabled:opacity-40 not-disabled:[&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary-500 [&::-webkit-slider-thumb]:transition-colors not-disabled:hover:[&::-webkit-slider-thumb]:ring-3 not-disabled:hover:[&::-webkit-slider-thumb]:ring-ring/10 not-disabled:active:[&::-webkit-slider-thumb]:bg-primary-600",
  {
    variants: {
      direction: {
        horizontal: "w-full",
        vertical: "h-80 [direction:rtl] [writing-mode:vertical-rl]",
      },
      size: {
        sm: "[&::-webkit-slider-thumb]:size-2.5",
        md: "[&::-webkit-slider-thumb]:size-3",
        lg: "[&::-webkit-slider-thumb]:size-3.5",
      },
    },
    compoundVariants: [
      { direction: "horizontal", size: "sm", className: "h-0.5 max-h-0.5" },
      { direction: "horizontal", size: "md", className: "h-1 max-h-1" },
      { direction: "horizontal", size: "lg", className: "h-1.5 max-h-1.5" },
      { direction: "vertical", size: "sm", className: "w-0.5 max-w-0.5" },
      { direction: "vertical", size: "md", className: "w-1 max-w-1" },
      { direction: "vertical", size: "lg", className: "w-1.5 max-w-1.5" },
    ],
    defaultVariants: {
      direction: "horizontal",
      size: "md",
    },
  },
);

export type SliderProps = Omit<
  React.ComponentProps<"input">,
  "value" | "min" | "max" | "step" | "onChange" | "size"
> &
  VariantProps<typeof variants> & {
    value?: number | null;
    min?: number;
    max?: number;
    step?: number;
    onChange?: (value: number) => void;
  };

export default function Slider({
  min,
  max,
  step,
  value,
  direction,
  size,
  className,
  onChange,
  ...props
}: SliderProps) {
  return (
    <input
      {...props}
      type="range"
      className={variants({
        className,
        direction,
        size,
      })}
      step={step}
      min={min}
      max={max}
      value={value === null ? "" : value}
      onChange={(e) => onChange?.(Number(e.target.value))}
    />
  );
}
