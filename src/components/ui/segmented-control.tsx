"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { motion } from "motion/react";
import { useId, useState } from "react";
import { cn } from "@/utils/cn";

const segmentVariants = cva(
  "relative z-1 flex-1 cursor-pointer whitespace-nowrap rounded-sm px-3 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
  {
    variants: {
      size: {
        sm: "py-1 text-xs",
        md: "py-1.5 text-sm",
      },
      variant: {
        primary: "",
        secondary: "",
      },
      active: {
        true: "",
        false: "text-content-300 not-disabled:hover:text-content-200",
      },
    },
    compoundVariants: [
      {
        variant: "primary",
        active: true,
        className: "text-primary-content",
      },
      {
        variant: "secondary",
        active: true,
        className: "text-content-100",
      },
    ],
    defaultVariants: {
      size: "md",
      variant: "primary",
      active: false,
    },
  },
);

const thumbVariants = cva("absolute inset-0 -z-1 rounded-sm", {
  variants: {
    variant: {
      primary: "bg-primary-500",
      secondary: "bg-base-400",
    },
  },
  defaultVariants: {
    variant: "primary",
  },
});

export type SegmentedControlItem<T extends string | number = string> = {
  value: T;
  label: React.ReactNode;
  disabled?: boolean;
};

export type SegmentedControlProps<T extends string | number = string> = Omit<
  React.ComponentProps<"div">,
  "onChange"
> &
  Pick<VariantProps<typeof segmentVariants>, "size" | "variant"> & {
    items: SegmentedControlItem<T>[];
    value?: T;
    defaultValue?: T;
    onChange?: (value: T) => void;
  };

export default function SegmentedControl<T extends string | number = string>({
  items,
  value: controlledValue,
  defaultValue,
  onChange,
  size,
  variant,
  className,
  ...props
}: SegmentedControlProps<T>) {
  const [internal, setInternal] = useState<T | undefined>(
    defaultValue ?? items[0]?.value,
  );
  const isControlled = controlledValue !== undefined;
  const current = isControlled ? controlledValue : internal;
  const layoutId = useId();

  function handleChange(next: T) {
    if (!isControlled) setInternal(next);
    onChange?.(next);
  }

  return (
    <div
      role="radiogroup"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-md border border-base-400 bg-base-100 p-0.5",
        className,
      )}
      {...props}
    >
      {items.map((item) => {
        const isActive = item.value === current;
        return (
          <button
            type="button"
            key={item.value}
            role="radio"
            aria-checked={isActive}
            disabled={item.disabled}
            onClick={() => handleChange(item.value)}
            className={cn(segmentVariants({ size, variant, active: isActive }))}
          >
            {item.label}
            {isActive && (
              <motion.span
                aria-hidden
                layoutId={layoutId}
                // only re-measure when the selection changes — without this, any page
                // reflow (e.g. a dialog growing) re-measures the moved thumb and
                // animates it "flying" from its old viewport position
                layoutDependency={current}
                className={cn(thumbVariants({ variant }))}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
