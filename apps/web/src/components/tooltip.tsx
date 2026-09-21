"use client";

import { cloneElement, isValidElement, useId, useState, type ReactElement, type KeyboardEvent } from "react";

/**
 * Accessible tooltip: shows on hover AND focus (never hover-only, so keyboard
 * users get the same information), dismissible with Escape. `children` must
 * be a single element that accepts `aria-describedby` and forwards its own
 * `onMouseEnter`/`onMouseLeave`/`onFocus`/`onBlur` (a native interactive
 * element such as `<button>` does this by default).
 */
export function Tooltip({ content, children }: { content: string; children: ReactElement }) {
  const [open, setOpen] = useState(false);
  const id = useId();

  if (!isValidElement(children)) return children;

  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (e.key === "Escape") setOpen(false);
  }

  const child = children as ReactElement<Record<string, unknown>>;
  const trigger = cloneElement(child, {
    "aria-describedby": open ? id : undefined,
    onMouseEnter: () => setOpen(true),
    onMouseLeave: () => setOpen(false),
    onFocus: () => setOpen(true),
    onBlur: () => setOpen(false),
    onKeyDown,
  });

  return (
    <span className="relative inline-flex">
      {trigger}
      {open && (
        <span
          role="tooltip"
          id={id}
          className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs text-white shadow"
        >
          {content}
        </span>
      )}
    </span>
  );
}
