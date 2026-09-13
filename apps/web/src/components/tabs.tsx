"use client";

import { createContext, useContext, useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/format";

interface TabsContextValue {
  value: string;
  setValue: (v: string) => void;
  idBase: string;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext(component: string): TabsContextValue {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error(`<${component}> must be rendered inside <Tabs>`);
  return ctx;
}

/** Accessible tabs (WAI-ARIA tabs pattern: roving tabindex, arrow-key nav). */
export function Tabs({
  value,
  defaultValue,
  onValueChange,
  children,
  className,
}: {
  value?: string;
  defaultValue?: string;
  onValueChange?: (v: string) => void;
  children: ReactNode;
  className?: string;
}) {
  const [internal, setInternal] = useState(defaultValue ?? "");
  const idBase = useId();
  const current = value ?? internal;

  function setValue(v: string) {
    if (value === undefined) setInternal(v);
    onValueChange?.(v);
  }

  return (
    <TabsContext.Provider value={{ value: current, setValue, idBase }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

export function TabList({ children, label }: { children: ReactNode; label: string }) {
  useTabsContext("TabList");

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const tabs = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    const idx = tabs.findIndex((t) => t === document.activeElement);
    if (idx === -1) return;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      tabs[(idx + 1) % tabs.length]?.focus();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      tabs[(idx - 1 + tabs.length) % tabs.length]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      tabs[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      tabs[tabs.length - 1]?.focus();
    }
  }

  return (
    <div role="tablist" aria-label={label} className="flex gap-1 border-b border-line" onKeyDown={onKeyDown}>
      {children}
    </div>
  );
}

export function Tab({ value: tabValue, children }: { value: string; children: ReactNode }) {
  const { value, setValue, idBase } = useTabsContext("Tab");
  const selected = value === tabValue;
  return (
    <button
      type="button"
      role="tab"
      id={`${idBase}-tab-${tabValue}`}
      aria-controls={`${idBase}-panel-${tabValue}`}
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      onClick={() => setValue(tabValue)}
      className={cn(
        "lt-focus -mb-px border-b-2 px-3 py-2 text-sm font-medium transition",
        selected
          ? "border-brand-600 text-brand-700"
          : "border-transparent text-muted hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

export function TabPanel({ value: tabValue, children }: { value: string; children: ReactNode }) {
  const { value, idBase } = useTabsContext("TabPanel");
  if (value !== tabValue) return null;
  return (
    <div
      role="tabpanel"
      id={`${idBase}-panel-${tabValue}`}
      aria-labelledby={`${idBase}-tab-${tabValue}`}
      tabIndex={0}
      className="pt-4"
    >
      {children}
    </div>
  );
}
