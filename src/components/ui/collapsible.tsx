"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { ChevronDownIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useId, useState } from "react";
import { cn } from "@/utils/cn";

const variants = cva("rounded-md text-content-100 text-sm", {
  variants: {
    bordered: {
      true: "border border-base-400 bg-base-100",
      false: "",
    },
    disabled: {
      true: "opacity-40",
      false: "",
    },
  },
  defaultVariants: {
    bordered: false,
    disabled: false,
  },
});

export type CollapsibleProps = Omit<
  React.ComponentProps<"div">,
  "title" | "onChange" | "value" | "defaultValue"
> &
  VariantProps<typeof variants> & {
    title: React.ReactNode;
    value?: boolean;
    defaultValue?: boolean;
    onChange?: (open: boolean) => void;
    chevron?: boolean | ((open: boolean) => React.ReactNode);
  };

export default function Collapsible({
  title,
  value: controlledValue,
  defaultValue = false,
  onChange,
  chevron = true,
  bordered,
  disabled,
  className,
  children,
  ...props
}: CollapsibleProps) {
  const [internal, setInternal] = useState(defaultValue);
  const isControlled = controlledValue !== undefined;
  const open = isControlled ? controlledValue : internal;
  const triggerId = useId();
  const contentId = useId();

  function handleToggle() {
    if (!isControlled) setInternal(!open);
    onChange?.(!open);
  }

  return (
    <div className={cn(variants({ className, bordered, disabled }))} {...props}>
      <div className="flex items-center">
        <button
          type="button"
          id={triggerId}
          aria-expanded={open}
          aria-controls={contentId}
          disabled={disabled ?? false}
          onClick={handleToggle}
          className="flex h-9 min-w-0 flex-1 not-disabled:cursor-pointer items-center gap-2 rounded-md px-3 text-left font-medium outline-none transition-all focus-visible:ring-3 focus-visible:ring-ring/10 disabled:cursor-not-allowed"
        >
          {typeof title === "string" ? (
            <span className="flex-1 truncate">{title}</span>
          ) : (
            title
          )}
          {chevron === true && (
            <ChevronDownIcon
              className={cn(
                "size-3.5 shrink-0 transition-transform duration-200",
                open && "rotate-180",
              )}
            />
          )}
        </button>
        {typeof chevron === "function" && chevron(open)}
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={contentId}
            role="region"
            aria-labelledby={triggerId}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 text-content-200">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
