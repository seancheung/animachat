/** biome-ignore-all lint/correctness/useExhaustiveDependencies: refs are stable; only re-bind when open toggles */
/* eslint-disable react-hooks/exhaustive-deps */
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
  "flex min-w-50 flex-wrap items-center gap-1 rounded-md border bg-base-100 text-content-100 transition-all",
  {
    variants: {
      size: {
        sm: "min-h-6 py-0.5 pr-1 text-xs",
        md: "min-h-8 py-1 pr-1.5 text-sm",
        lg: "min-h-9 py-1 pr-2 text-base",
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

export type MultiComboboxOption<T> = {
  value: T;
  label: string;
  disabled?: boolean;
};

export type MultiComboboxProps<T = unknown> = Omit<
  React.ComponentProps<"input">,
  "value" | "onChange" | "defaultValue" | "type" | "size"
> &
  VariantProps<typeof containerVariants> & {
    value?: T[];
    defaultValue?: T[];
    onChange?: (values: T[]) => void;
    options: MultiComboboxOption<T>[];
    placeholder?: string;
    emptyMessage?: React.ReactNode;
    loadingMessage?: React.ReactNode;
    icon?: React.ReactNode;
    clearable?: boolean;
    onClear?: () => void;
    acceptCustom?: boolean;
    createMessage?: (text: string) => React.ReactNode;
    onSearch?: (query: string) => void;
    loading?: boolean;
    hasMore?: boolean;
    isFetchingMore?: boolean;
    onLoadMore?: () => void;
    maxTagCount?: number;
    hideTags?: boolean;
    renderOption?: (option: MultiComboboxOption<T>) => React.ReactNode;
  };

type RenderItem<T> =
  | { type: "create"; text: string }
  | { type: "option"; option: MultiComboboxOption<T> };

export default function MultiCombobox<T = unknown>({
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
  createMessage = (text) => `Add “${text}”`,
  onSearch,
  loading = false,
  hasMore = false,
  isFetchingMore = false,
  onLoadMore,
  maxTagCount,
  hideTags = false,
  renderOption,
  error,
  disabled,
  size,
  className,
  ...props
}: MultiComboboxProps<T>) {
  const [internalValue, setInternalValue] = useState<T[]>(defaultValue ?? []);
  const isControlled = controlledValue !== undefined;
  const values = isControlled ? controlledValue : internalValue;

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) setInputValue("");
  }, [open]);

  const tags = values.map((v) => {
    const option = options.find((o) => o.value === v);
    return { value: v, label: option?.label ?? String(v) };
  });
  const visibleTags = hideTags
    ? []
    : maxTagCount != null
      ? tags.slice(0, maxTagCount)
      : tags;
  const hiddenCount = hideTags ? 0 : tags.length - visibleTags.length;

  const trimmed = inputValue.trim();
  const query = trimmed.toLowerCase();
  const isSearching = open && query.length > 0;

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
    !options.some((o) => o.label === trimmed || o.value === trimmed) &&
    !values.includes(trimmed as T);

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

  function commit(next: T[]) {
    if (!isControlled) setInternalValue(next);
    onChange?.(next);
  }

  function resetSearch() {
    setInputValue("");
    onSearch?.("");
    setActiveIndex(null);
  }

  function toggleOption(opt: MultiComboboxOption<T>) {
    if (opt.disabled) return;
    commit(
      values.includes(opt.value)
        ? values.filter((v) => v !== opt.value)
        : [...values, opt.value],
    );
    resetSearch();
  }

  function commitCustom(text: string) {
    if (!values.includes(text as T)) commit([...values, text as T]);
    resetSearch();
  }

  function handleSelectIndex(idx: number) {
    const item = items[idx];
    if (!item) return;
    if (item.type === "create") commitCustom(item.text);
    else toggleOption(item.option);
  }

  function handleRemove(value: T) {
    commit(values.filter((v) => v !== value));
  }

  function handleClear() {
    commit([]);
    onClear?.();
    resetSearch();
    setOpen(false);
  }

  const showClear = clearable && !disabled && values.length > 0;
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
        onClick={() => {
          if (!disabled) inputRef.current?.focus();
        }}
        className={cn(
          "group relative",
          containerVariants({ className, size, error, disabled }),
          visibleTags.length > 0
            ? "pl-1"
            : { sm: "pl-2", md: "pl-3", lg: "pl-3.5" }[size ?? "md"],
        )}
        data-open={open || undefined}
      >
        {icon && (
          <span className="has-icon shrink-0 text-content-400">{icon}</span>
        )}
        {visibleTags.map((tag) => (
          <span
            key={String(tag.value)}
            className="inline-flex max-w-full items-center gap-1 rounded-sm bg-base-300 py-0.5 pr-1 pl-1.5 text-content-200 text-xs"
          >
            <span className="truncate">{tag.label}</span>
            <button
              type="button"
              tabIndex={-1}
              aria-label={`Remove ${tag.label}`}
              disabled={disabled}
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.stopPropagation();
                handleRemove(tag.value);
              }}
              className="inline-flex shrink-0 cursor-pointer items-center justify-center rounded-sm text-content-400 transition hover:text-content-200"
            >
              <XIcon className="size-3" />
            </button>
          </span>
        ))}
        {hiddenCount > 0 && (
          <span className="inline-flex items-center rounded-sm bg-base-300 px-1.5 py-0.5 text-content-300 text-xs">
            +{hiddenCount}
          </span>
        )}
        <input
          {...props}
          ref={inputRef}
          type="text"
          role="combobox"
          value={inputValue}
          placeholder={hideTags || tags.length === 0 ? placeholder : undefined}
          disabled={disabled}
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={
            activeIndex !== null ? `${listId}-${activeIndex}` : undefined
          }
          className="w-8 min-w-0 flex-1 border-none bg-transparent outline-none placeholder:text-content-400"
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
              if (
                e.key === "Backspace" &&
                !hideTags &&
                inputValue.length === 0 &&
                values.length > 0
              ) {
                handleRemove(values[values.length - 1]);
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
            onClick={(e) => {
              e.stopPropagation();
              if (disabled) return;
              setOpen((v) => !v);
            }}
            className={cn(
              "has-icon-3.5 absolute inset-0 inline-flex cursor-pointer items-center justify-center rounded-sm text-content-400 transition icon:transition-transform not-disabled:hover:text-content-300",
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
              onClick={(e) => {
                e.stopPropagation();
                handleClear();
              }}
              className="has-icon-3.5 absolute inset-0 inline-flex cursor-pointer items-center justify-center rounded-sm text-content-400 opacity-0 transition hover:text-content-200 group-focus-within:opacity-100 group-hover:opacity-100"
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
            {...getFloatingProps({ "aria-multiselectable": true })}
          >
            <div
              id={listId}
              style={{ ...transitionStyles, maxHeight: "inherit" }}
              className="flex flex-col overflow-y-auto rounded-md border border-base-400 bg-base-100 p-1 text-content-100 text-sm shadow-(--shadow-overlay)"
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
                const isSelected = opt !== null && values.includes(opt.value);
                return (
                  <div
                    key={isCreate ? "__create__" : i.toString()}
                    id={`${listId}-${i}`}
                    ref={(el) => {
                      listRef.current[i] = el;
                    }}
                    role="option"
                    tabIndex={-1}
                    aria-selected={isSelected}
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
                          {createMessage(item.text)}
                        </span>
                      </>
                    ) : (
                      <>
                        <span
                          aria-hidden
                          className={cn(
                            "inline-flex size-3.5 shrink-0 items-center justify-center rounded-sm border transition-colors",
                            isSelected
                              ? "border-primary-500 bg-primary-500 text-primary-content"
                              : "border-base-400 bg-base-100",
                          )}
                        >
                          {isSelected && (
                            <CheckIcon strokeWidth={3} className="size-3" />
                          )}
                        </span>
                        {renderOption && opt ? (
                          renderOption(opt)
                        ) : (
                          <span className="flex-1 truncate">{opt?.label}</span>
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
                  {loadingMessage}
                </div>
              )}
            </div>
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
