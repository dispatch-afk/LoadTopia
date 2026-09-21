"use client";

import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";
import { cn } from "@/lib/format";
import { Button, Field, Input, Spinner, Textarea } from "./ui";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Accessible modal dialog: focus moves in on open, is trapped inside the
 * panel, Escape closes, and focus returns to the triggering element on close.
 * Built as a plain `role="dialog"` panel rather than the native `<dialog>`
 * element so this behavior is deterministic in every environment this app
 * runs and is tested in (native `<dialog>` modal semantics are still
 * inconsistently implemented across browsers/jsdom).
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
  initialFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  initialFocusRef?: RefObject<HTMLElement | null>;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const target =
      initialFocusRef?.current ?? panelRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    target?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onOpenChange(false);
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      previouslyFocused.current?.focus();
    };
  }, [open, onOpenChange, initialFocusRef]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40" aria-hidden="true" onClick={() => onOpenChange(false)} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        className={cn(
          "relative w-full max-w-md rounded-xl border border-line bg-white p-5 shadow-lg",
          className,
        )}
      >
        <h2 id={titleId} className="text-base font-semibold text-ink">
          {title}
        </h2>
        {description && (
          <p id={descId} className="mt-1 text-sm text-muted">
            {description}
          </p>
        )}
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

/**
 * Replaces `window.confirm(...)` for a destructive/consequential action.
 * Focus defaults to Cancel (not the confirming button) so a stray Enter
 * keypress never triggers the destructive action.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "default",
  busy = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
  busy?: boolean;
  onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      initialFocusRef={cancelRef}
    >
      <div className="flex flex-wrap justify-end gap-2">
        <Button ref={cancelRef} variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
          {cancelLabel}
        </Button>
        <Button variant={tone === "danger" ? "danger" : "primary"} onClick={onConfirm} disabled={busy}>
          {busy && <Spinner />} {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}

/**
 * Replaces `window.prompt(...)` for a workflow that needs a short text value
 * (e.g. an optional cancellation reason). Unlike `ConfirmDialog`, this always
 * carries an input — never use it where a plain confirmation is all that's
 * needed.
 */
export function PromptDialog({
  open,
  onOpenChange,
  title,
  description,
  label,
  placeholder,
  required = false,
  multiline = false,
  maxLength,
  submitLabel = "Submit",
  cancelLabel = "Cancel",
  busy = false,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  multiline?: boolean;
  maxLength?: number;
  submitLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  onSubmit: (value: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const value = (multiline ? textareaRef.current?.value : inputRef.current?.value)?.trim() ?? "";
    onSubmit(value);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} description={description}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <Field label={label} required={required}>
          {multiline ? (
            <Textarea ref={textareaRef} placeholder={placeholder} required={required} maxLength={maxLength} />
          ) : (
            <Input ref={inputRef} placeholder={placeholder} required={required} maxLength={maxLength} />
          )}
        </Field>
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button type="submit" disabled={busy}>
            {busy && <Spinner />} {submitLabel}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
