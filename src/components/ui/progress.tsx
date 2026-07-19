"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/utils/cn";

const trackVariants = cva(
  "relative w-full overflow-hidden rounded-full bg-base-400",
  {
    variants: {
      size: {
        sm: "h-0.75",
        md: "h-1.5",
      },
    },
    defaultVariants: {
      size: "md",
    },
  },
);

const fillVariants = cva(
  "h-full rounded-full bg-(--bg-color) transition-[width] duration-500 ease-out",
  {
    variants: {
      variant: {
        primary: "[--bg-color:var(--color-primary-500)]",
        success: "[--bg-color:var(--color-success)]",
        info: "[--bg-color:var(--color-info)]",
        error: "[--bg-color:var(--color-error)]",
      },
    },
    defaultVariants: {
      variant: "primary",
    },
  },
);

const circularVariants = cva("shrink-0", {
  variants: {
    variant: {
      primary: "[--bg-color:var(--color-primary-500)]",
      success: "[--bg-color:var(--color-success)]",
      info: "[--bg-color:var(--color-info)]",
      error: "[--bg-color:var(--color-error)]",
    },
    size: {
      sm: "size-6",
      md: "size-8",
    },
  },
  defaultVariants: {
    variant: "primary",
    size: "md",
  },
});

const CIRCULAR_GEOMETRY = {
  sm: { diameter: 24, stroke: 2.5 },
  md: { diameter: 40, stroke: 4 },
} as const;

export type ProgressProps = Omit<React.ComponentProps<"div">, "children"> &
  VariantProps<typeof trackVariants> &
  VariantProps<typeof fillVariants> & {
    value?: number;
    max?: number;
    shape?: "linear" | "circular";
  };

export default function Progress({
  className,
  size,
  variant,
  value = 0,
  max = 100,
  shape = "linear",
  ...props
}: ProgressProps) {
  const percent = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;

  if (shape === "circular") {
    const sizeKey = size ?? "md";
    const { diameter, stroke } = CIRCULAR_GEOMETRY[sizeKey];
    const radius = (diameter - stroke) / 2;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference * (1 - percent / 100);
    const center = diameter / 2;

    return (
      <div
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        className={cn(circularVariants({ size, variant, className }))}
        {...props}
      >
        <svg
          viewBox={`0 0 ${diameter} ${diameter}`}
          className="size-full -rotate-90"
          aria-hidden="true"
        >
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="var(--color-base-100)"
            strokeWidth={stroke}
          />
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="var(--bg-color)"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className="transition-[stroke-dashoffset] duration-500 ease-out"
          />
        </svg>
      </div>
    );
  }

  return (
    <div
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      className={cn(trackVariants({ className, size }))}
      {...props}
    >
      <div
        className={cn(fillVariants({ variant }))}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
