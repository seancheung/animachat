"use client";

import {
  autoUpdate,
  FloatingFocusManager,
  FloatingPortal,
  flip,
  size as floatingSize,
  offset,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
  useListNavigation,
  useRole,
  useTransitionStyles,
  useTypeahead,
} from "@floating-ui/react";
import { cva, type VariantProps } from "class-variance-authority";
import { CheckIcon, ChevronDownIcon, XIcon } from "lucide-react";
import { useRef, useState } from "react";
import { cn } from "@/utils/cn";

const triggerVariants = cva(
  "has-icon inline-flex min-w-50 not-disabled:cursor-pointer items-center gap-1.5 rounded-md border bg-base-100 icon:text-content-400 text-content-100 outline-none transition-all",
  {
    variants: {
      size: {
        sm: "h-6 px-2 text-xs",
        md: "h-8 px-3 text-sm",
        lg: "h-9 px-3.5 text-base",
      },
      error: {
        true: "border-error focus-visible:ring-3 focus-visible:ring-error/10 data-[open=true]:ring-3 data-[open=true]:ring-error/10",
        false:
          "border-base-400 focus-visible:border-primary-500 focus-visible:ring-3 focus-visible:ring-ring/10 data-[open=true]:border-primary-500 data-[open=true]:ring-3 data-[open=true]:ring-ring/10",
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

export type SelectOption<T> = {
  value: T;
  label: string;
  disabled?: boolean;
};

export type SelectProps<T = unknown> = Omit<
  React.ComponentProps<"button">,
  "value" | "onChange" | "defaultValue"
> &
  VariantProps<typeof triggerVariants> & {
    value?: T | null;
    defaultValue?: T;
    onChange?: (value: T) => void;
    options: SelectOption<T>[];
    placeholder?: string;
    emptyMessage?: React.ReactNode;
    icon?: React.ReactNode;
    clearable?: boolean;
    onClear?: () => void;
    renderOption?: (option: SelectOption<T>) => React.ReactNode;
  };

export default function Select<T = unknown>({
  value: controlledValue,
  defaultValue,
  onChange,
  options,
  placeholder = "Select…",
  emptyMessage = "No options",
  icon,
  error,
  disabled,
  size,
  className,
  clearable,
  onClear,
  renderOption,
  ...props
}: SelectProps<T>) {
  const [internalValue, setInternalValue] = useState<T | undefined>(
    defaultValue,
  );
  const isControlled = controlledValue !== undefined;
  const value = isControlled ? controlledValue : internalValue;

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const selectedIndex =
    value === undefined ? -1 : options.findIndex((o) => o.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  const { refs, floatingStyles, context, placement } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: "bottom-start",
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(6),
      flip({ padding: 8 }),
      floatingSize({
        apply({ rects, elements, availableHeight }) {
          Object.assign(elements.floating.style, {
            minWidth: `${rects.reference.width}px`,
            maxHeight: `${Math.min(availableHeight - 8, 320)}px`,
          });
        },
        padding: 8,
      }),
    ],
  });

  const listRef = useRef<Array<HTMLElement | null>>([]);
  const labelsRef = useRef<Array<string | null>>(options.map((o) => o.label));

  const click = useClick(context, { event: "mousedown" });
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: "listbox" });
  const listNav = useListNavigation(context, {
    listRef,
    activeIndex,
    selectedIndex: selectedIndex >= 0 ? selectedIndex : null,
    onNavigate: setActiveIndex,
    loop: true,
  });
  const typeahead = useTypeahead(context, {
    listRef: labelsRef,
    activeIndex,
    selectedIndex: selectedIndex >= 0 ? selectedIndex : null,
    onMatch(i) {
      if (open) setActiveIndex(i);
      else handleSelect(i);
    },
  });

  const { getReferenceProps, getFloatingProps, getItemProps } = useInteractions(
    [click, dismiss, role, listNav, typeahead],
  );

  const isAbove = placement.startsWith("top");
  const { isMounted, styles: transitionStyles } = useTransitionStyles(context, {
    duration: { open: 150, close: 100 },
    initial: {
      opacity: 0,
      transform: `scale(0.96) translateY(${isAbove ? 4 : -4}px)`,
    },
    open: { opacity: 1, transform: "scale(1) translateY(0)" },
  });

  function handleSelect(index: number) {
    const opt = options[index];
    if (!opt || opt.disabled) return;
    if (!isControlled) setInternalValue(opt.value);
    onChange?.(opt.value);
    setOpen(false);
    setActiveIndex(null);
  }

  const showClear = clearable && !disabled && value != null;
  const handleClear = () => {
    if (!isControlled) setInternalValue(undefined);
    onClear?.();
    setOpen(false);
    setActiveIndex(null);
  };

  return (
    <>
      <button
        type="button"
        ref={refs.setReference}
        disabled={disabled ?? false}
        data-open={open}
        className={cn(
          "group",
          triggerVariants({ className, size, error, disabled }),
        )}
        {...getReferenceProps(props)}
      >
        {icon}
        <span
          className={cn(
            "flex-1 truncate text-left",
            !selected && "text-content-400",
          )}
        >
          {selected?.label ?? placeholder}
        </span>
        {showClear ? (
          <span className="relative inline-flex size-icon shrink-0 items-center justify-center">
            <ChevronDownIcon
              className={cn(
                "absolute size-full text-content-400 transition group-hover:opacity-0 group-data-[open=true]:text-content-300",
                open && "rotate-180",
              )}
            />
            <span
              role="button"
              tabIndex={-1}
              aria-label="Clear"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                handleClear();
              }}
              className="absolute inset-0 inline-flex cursor-pointer items-center justify-center text-content-400 opacity-0 transition hover:text-content-200 group-hover:opacity-100"
            >
              <XIcon className="size-full" />
            </span>
          </span>
        ) : (
          <ChevronDownIcon className={cn(open && "rotate-180")} />
        )}
      </button>
      {isMounted && !disabled && (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false}>
            <div
              ref={refs.setFloating}
              style={floatingStyles}
              className={cn(
                "z-50 outline-none",
                isAbove ? "origin-bottom" : "origin-top",
              )}
              {...getFloatingProps()}
            >
              <div
                style={{ ...transitionStyles, maxHeight: "inherit" }}
                className="flex flex-col overflow-y-auto rounded-md border border-base-400 bg-base-100 p-1 text-content-100 text-sm shadow-(--shadow-overlay)"
              >
                {options.length === 0 && (
                  <div className="px-2 py-2 text-content-400 text-xs">
                    {emptyMessage}
                  </div>
                )}
                {options.map((opt, i) => (
                  <div
                    key={i.toString()}
                    ref={(el) => {
                      listRef.current[i] = el;
                    }}
                    role="option"
                    tabIndex={activeIndex === i ? 0 : -1}
                    aria-selected={opt.value === value}
                    aria-disabled={opt.disabled || undefined}
                    data-active={activeIndex === i}
                    className={cn(
                      "flex h-7 shrink-0 cursor-pointer items-center gap-2 rounded-sm px-2 outline-none transition-colors",
                      "data-[active=true]:bg-base-300 data-[active=true]:text-content-100",
                      "aria-disabled:cursor-not-allowed aria-disabled:opacity-40",
                    )}
                    {...getItemProps({
                      onClick: () => handleSelect(i),
                      onKeyDown(event) {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          handleSelect(i);
                        }
                        if (
                          event.key === " " &&
                          !context.dataRef.current.typing
                        ) {
                          event.preventDefault();
                          handleSelect(i);
                        }
                      },
                    })}
                  >
                    {renderOption && opt ? (
                      renderOption(opt)
                    ) : (
                      <span className="flex-1 truncate">{opt.label}</span>
                    )}
                    {opt.value === value && (
                      <CheckIcon className="size-3.5 text-content-100" />
                    )}
                  </div>
                ))}
              </div>
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </>
  );
}
