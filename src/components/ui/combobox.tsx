"use client";

import {
  autoUpdate,
  FloatingPortal,
  flip,
  size as floatingSize,
  offset,
  useDismiss,
  useFloating,
  useInteractions,
  useListNavigation,
  useRole,
  useTransitionStyles,
} from "@floating-ui/react";
import { cva, type VariantProps } from "class-variance-authority";
import {
  CheckIcon,
  ChevronDownIcon,
  Loader2Icon,
  PlusIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/utils/cn";

const containerVariants = cva(
  "flex h-8 min-w-50 items-center gap-1.5 rounded-md border bg-base-100 pr-1.5 pl-3 text-content-100 text-sm transition-all",
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

export type ComboboxOption<T> = {
  value: T;
  label: string;
  disabled?: boolean;
};

export type ComboboxProps<T = unknown> = Omit<
  React.ComponentProps<"input">,
  "value" | "onChange" | "defaultValue" | "type"
> &
  VariantProps<typeof containerVariants> & {
    value?: T | null;
    defaultValue?: T;
    onChange?: (value: T) => void;
    options: ComboboxOption<T>[];
    placeholder?: string;
    emptyMessage?: React.ReactNode;
    loadingMessage?: React.ReactNode;
    icon?: React.ReactNode;
    clearable?: boolean;
    onClear?: () => void;
    acceptCustom?: boolean;
    onSearch?: (query: string) => void;
    loading?: boolean;
    hasMore?: boolean;
    isFetchingMore?: boolean;
    onLoadMore?: () => void;
    /** custom option-row content (e.g. icon + name), rendered before the check mark;
     *  defaults to a truncated label. Filtering still matches against `label`. */
    renderOption?: (option: ComboboxOption<T>) => React.ReactNode;
  };

type RenderItem<T> =
  | { type: "create"; text: string }
  | { type: "option"; option: ComboboxOption<T> };

export default function Combobox<T = unknown>({
  value: controlledValue,
  defaultValue,
  onChange,
  options,
  placeholder = "Select…",
  emptyMessage = "No matches",
  loadingMessage = "Loading…",
  icon,
  clearable = false,
  onClear,
  acceptCustom = false,
  onSearch,
  loading = false,
  hasMore = false,
  isFetchingMore = false,
  onLoadMore,
  renderOption,
  error,
  disabled,
  className,
  ...props
}: ComboboxProps<T>) {
  const [internalValue, setInternalValue] = useState<T | undefined>(
    defaultValue,
  );
  const isControlled = controlledValue !== undefined;
  const value = isControlled ? controlledValue : internalValue;
  const selected = options.find((o) => o.value === value);
  const displayLabel =
    selected?.label ?? (acceptCustom && typeof value === "string" ? value : "");

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [inputValue, setInputValue] = useState(displayLabel);

  useEffect(() => {
    if (!open) setInputValue(displayLabel);
  }, [open, displayLabel]);

  const trimmed = inputValue.trim();
  const query = trimmed.toLowerCase();
  const isSearching = open && query.length > 0 && inputValue !== displayLabel;

  // When onSearch is provided, treat options as already filtered server-side
  const filtered = onSearch
    ? options
    : isSearching
      ? options.filter((o) => o.label.toLowerCase().includes(query))
      : options;

  const showCreate =
    acceptCustom &&
    open &&
    trimmed.length > 0 &&
    !options.some((o) => o.label === trimmed || o.value === trimmed);

  const items: RenderItem<T>[] = [];
  if (showCreate) items.push({ type: "create", text: trimmed });
  for (const option of filtered) items.push({ type: "option", option });

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
  const listId = useId();

  // useDismiss handles escape + outside detection inside the floating tree,
  // but its outside-press listener gets eaten when nested inside a modal
  // Dialog's FloatingFocusManager. The capture-phase mousedown effect below
  // is the actual outside-close path for that case.
  const dismiss = useDismiss(context, {
    capture: { outsidePress: true, escapeKey: true },
  });

  // eslint-disable-next-line react-hooks/exhaustive-deps -- refs are stable; only re-bind when open toggles
  useEffect(() => {
    if (!open) return;
    function handle(event: MouseEvent) {
      const target = event.target as Node | null;
      if (!target) return;
      const ref = refs.reference.current;
      const float = refs.floating.current;
      if (ref instanceof Element && ref.contains(target)) return;
      if (float instanceof Element && float.contains(target)) return;
      setOpen(false);
      setActiveIndex(null);
    }
    document.addEventListener("mousedown", handle, true);
    return () => document.removeEventListener("mousedown", handle, true);
  }, [open]);
  const role = useRole(context, { role: "listbox" });
  const listNav = useListNavigation(context, {
    listRef,
    activeIndex,
    onNavigate: setActiveIndex,
    virtual: true,
    loop: true,
  });

  const { getReferenceProps, getFloatingProps, getItemProps } = useInteractions(
    [dismiss, role, listNav],
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

  function commitOption(opt: ComboboxOption<T>) {
    if (opt.disabled) return;
    if (!isControlled) setInternalValue(opt.value);
    onChange?.(opt.value);
    setInputValue(opt.label);
    setOpen(false);
    setActiveIndex(null);
  }

  function commitCustom(text: string) {
    if (!isControlled) setInternalValue(text as T);
    onChange?.(text as T);
    setInputValue(text);
    setOpen(false);
    setActiveIndex(null);
  }

  function handleSelectIndex(idx: number) {
    const item = items[idx];
    if (!item) return;
    if (item.type === "create") commitCustom(item.text);
    else commitOption(item.option);
  }

  function handleClear() {
    if (!isControlled) setInternalValue(undefined);
    onClear?.();
    setInputValue("");
    onSearch?.("");
    setOpen(false);
    setActiveIndex(null);
  }

  const showClear = clearable && !disabled && displayLabel.length > 0;
  const showEmpty = !loading && items.length === 0;
  const showLoading = loading && items.length === 0;

  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open || !hasMore || !onLoadMore) return;
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isFetchingMore) onLoadMore();
      },
      { rootMargin: "60px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [open, hasMore, onLoadMore, isFetchingMore, items.length]);

  return (
    <>
      <div
        ref={refs.setReference}
        className={cn(
          "group relative",
          containerVariants({ className, error, disabled }),
        )}
        data-open={open || undefined}
      >
        {icon && (
          <span className="has-icon shrink-0 text-content-400">{icon}</span>
        )}
        <input
          {...props}
          type="text"
          role="combobox"
          value={inputValue}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={
            activeIndex !== null ? `${listId}-${activeIndex}` : undefined
          }
          className="w-full min-w-0 flex-1 border-none bg-transparent outline-none placeholder:text-content-400"
          {...getReferenceProps({
            onChange(e) {
              const next = (e.target as HTMLInputElement).value;
              setInputValue(next);
              if (!open) setOpen(true);
              setActiveIndex(0);
              onSearch?.(next);
            },
            onFocus() {
              if (!disabled && !open) setOpen(true);
            },
            onKeyDown(e) {
              if (e.key === "Enter") {
                if (activeIndex !== null && items[activeIndex]) {
                  e.preventDefault();
                  handleSelectIndex(activeIndex);
                } else if (acceptCustom && trimmed.length > 0) {
                  e.preventDefault();
                  commitCustom(trimmed);
                }
              }
            },
          })}
        />
        {loading && (
          <Loader2Icon className="size-3.5 shrink-0 animate-spin text-content-400" />
        )}
        <div className="relative -mr-0.5 inline-flex size-6 shrink-0 items-center justify-center">
          <button
            type="button"
            tabIndex={-1}
            aria-label={open ? "Collapse" : "Expand"}
            disabled={disabled}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              if (disabled) return;
              setOpen((v) => !v);
            }}
            className={cn(
              "has-icon-3.5 absolute inset-0 inline-flex cursor-pointer items-center justify-center rounded text-content-400 transition icon:transition-transform not-disabled:hover:text-content-300",
              showClear && "group-focus-within:opacity-0 group-hover:opacity-0",
            )}
          >
            <ChevronDownIcon className={cn(open && "rotate-180")} />
          </button>
          {showClear && (
            <button
              type="button"
              tabIndex={-1}
              aria-label="Clear"
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleClear}
              className="has-icon-3.5 absolute inset-0 inline-flex cursor-pointer items-center justify-center rounded text-content-400 opacity-0 transition hover:text-content-200 group-focus-within:opacity-100 group-hover:opacity-100"
            >
              <XIcon />
            </button>
          )}
        </div>
      </div>
      {isMounted && !disabled && (
        <FloatingPortal>
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
              id={listId}
              style={{ ...transitionStyles, maxHeight: "inherit" }}
              className="flex flex-col overflow-y-auto rounded-md border border-base-400 bg-base-100 p-1 text-content-100 text-sm shadow-lg"
            >
              {showLoading && (
                <div className="flex items-center justify-center gap-2 px-2 py-3 text-content-400 text-xs">
                  <Loader2Icon className="size-3.5 animate-spin" />
                  {loadingMessage}
                </div>
              )}
              {showEmpty && (
                <div className="px-2 py-2 text-content-400 text-xs">
                  {emptyMessage}
                </div>
              )}
              {items.map((item, i) => {
                const isActive = activeIndex === i;
                const isCreate = item.type === "create";
                const opt = isCreate ? null : item.option;
                return (
                  <div
                    key={isCreate ? "__create__" : i.toString()}
                    id={`${listId}-${i}`}
                    ref={(el) => {
                      listRef.current[i] = el;
                    }}
                    role="option"
                    tabIndex={-1}
                    aria-selected={!isCreate && opt?.value === value}
                    aria-disabled={(!isCreate && opt?.disabled) || undefined}
                    data-active={isActive}
                    className={cn(
                      "flex h-7 shrink-0 cursor-pointer items-center gap-2 rounded-sm px-2 outline-none transition-colors",
                      "data-[active=true]:bg-base-300 data-[active=true]:text-content-100",
                      "aria-disabled:cursor-not-allowed aria-disabled:opacity-40",
                    )}
                    {...getItemProps({
                      onMouseDown: (e) => e.preventDefault(),
                      onClick: () => handleSelectIndex(i),
                    })}
                  >
                    {isCreate ? (
                      <>
                        <PlusIcon className="size-3.5 shrink-0 text-content-300" />
                        <span className="flex-1 truncate">
                          Add &ldquo;{item.text}&rdquo;
                        </span>
                      </>
                    ) : (
                      <>
                        {renderOption && opt ? (
                          renderOption(opt)
                        ) : (
                          <span className="flex-1 truncate">{opt?.label}</span>
                        )}
                        {opt?.value === value && (
                          <CheckIcon className="size-3.5 text-content-200" />
                        )}
                      </>
                    )}
                  </div>
                );
              })}
              {hasMore && onLoadMore && items.length > 0 && (
                <div ref={sentinelRef} className="h-px" aria-hidden />
              )}
              {isFetchingMore && items.length > 0 && (
                <div className="flex items-center justify-center gap-2 py-2 text-content-400 text-xs">
                  <Loader2Icon className="size-3.5 animate-spin" />
                  Loading…
                </div>
              )}
            </div>
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
