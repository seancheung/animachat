"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { motion } from "motion/react";
import { useId, useState } from "react";
import { cn } from "@/utils/cn";

const triggerVariants = cva(
  "relative -mb-px cursor-pointer border-transparent border-b-2 px-4 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
  {
    variants: {
      size: {
        sm: "py-1.5 text-xs",
        md: "py-2 text-sm",
      },
      active: {
        true: "text-content-100",
        false: "text-content-300 not-disabled:hover:text-content-200",
      },
    },
    defaultVariants: {
      size: "md",
      active: false,
    },
  },
);

export type TabItem<T extends string | number = string> = {
  value: T;
  label: React.ReactNode;
  disabled?: boolean;
};

export type TabsProps<T extends string | number = string> = Omit<
  React.ComponentProps<"div">,
  "onChange"
> &
  Pick<VariantProps<typeof triggerVariants>, "size"> & {
    items: TabItem<T>[];
    value?: T;
    defaultValue?: T;
    onChange?: (value: T) => void;
  };

export default function Tabs<T extends string | number = string>({
  items,
  value: controlledValue,
  defaultValue,
  onChange,
  size,
  className,
  ...props
}: TabsProps<T>) {
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
      role="tablist"
      className={cn(
        "flex items-center gap-1 border-base-400 border-b",
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
            role="tab"
            aria-selected={isActive}
            disabled={item.disabled}
            onClick={() => handleChange(item.value)}
            className={cn(triggerVariants({ size, active: isActive }))}
          >
            {item.label}
            {isActive && (
              <motion.span
                aria-hidden
                layoutId={layoutId}
                className="absolute inset-x-0 -bottom-0.5 h-0.5 rounded-xs bg-primary-500"
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
