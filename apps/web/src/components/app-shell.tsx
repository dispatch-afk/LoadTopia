"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import type { MeResponse } from "@loadtopia/shared";
import { apiClient } from "@/lib/api-client";
import { cn } from "@/lib/format";
import { CARRIER_PRIMARY_NAV, SECONDARY_NAV, SHIPPER_PRIMARY_NAV, visibleNavItems, type NavItem } from "@/lib/nav-config";
import { Spinner } from "./ui";

function NavLink({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
      className={cn(
        "lt-focus block rounded-lg px-3 py-2.5 text-sm font-medium transition",
        active ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-50 hover:text-ink",
      )}
    >
      {item.label}
    </Link>
  );
}

export function AppShell({ me, children }: { me: MeResponse; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const active = me.memberships.find((m) => m.companyId === me.activeCompanyId);
  const companyType = active?.companyType ?? null;
  const showPostLoadCta = me.permissions.includes("load:create");

  const [switching, setSwitching] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const primary = visibleNavItems(
    companyType === "CARRIER" ? CARRIER_PRIMARY_NAV : SHIPPER_PRIMARY_NAV,
    me.permissions,
    companyType,
  );
  const secondary = visibleNavItems(SECONDARY_NAV, me.permissions, companyType);

  function isActive(href: string): boolean {
    return pathname === href || pathname.startsWith(href + "/");
  }

  async function switchCompany(companyId: string) {
    if (companyId === me.activeCompanyId) return;
    setSwitching(true);
    try {
      await apiClient("/auth/switch-company", {
        method: "POST",
        body: JSON.stringify({ companyId }),
      });
      setMenuOpen(false);
      // Locked Phase 11 behavior: always land on /dashboard after a switch,
      // rather than trying to infer whether the current detail route is
      // valid for the newly-selected company. router.refresh() guarantees a
      // fresh server-layout fetch (new /auth/me) even when already there.
      router.push("/dashboard");
      router.refresh();
    } finally {
      setSwitching(false);
    }
  }

  async function logout() {
    setLoggingOut(true);
    await apiClient("/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  function companySwitcher(idPrefix: string) {
    const selectId = `${idPrefix}-active-company-select`;
    return (
      <div className="px-3 pb-2">
        <label
          htmlFor={selectId}
          className="mb-1 block px-2 text-[0.7rem] font-medium uppercase tracking-wide text-muted"
        >
          Active company
        </label>
        <div className="relative">
          <select
            id={selectId}
            className="lt-focus w-full rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-sm font-medium"
            value={me.activeCompanyId ?? ""}
            disabled={switching || me.memberships.length < 2}
            onChange={(e) => switchCompany(e.target.value)}
          >
            {me.memberships
              .filter((m) => m.isActive)
              .map((m) => (
                <option key={m.companyId} value={m.companyId}>
                  {m.companyName} · {m.role}
                </option>
              ))}
          </select>
          {switching && (
            <span className="absolute right-2 top-2 text-brand-600">
              <Spinner />
            </span>
          )}
        </div>
      </div>
    );
  }

  function navSections(onNavigate?: () => void) {
    return (
      <>
        <nav aria-label="Primary" className="flex flex-col gap-1 px-3">
          {primary.map((item) => (
            <NavLink key={item.href} item={item} active={isActive(item.href)} onNavigate={onNavigate} />
          ))}
        </nav>
        {secondary.length > 0 && (
          <div className="mt-4 px-3">
            <p className="mb-1 px-2 text-[0.7rem] font-medium uppercase tracking-wide text-muted">
              Settings
            </p>
            <nav aria-label="Settings" className="flex flex-col gap-1">
              {secondary.map((item) => (
                <NavLink key={item.href} item={item} active={isActive(item.href)} onNavigate={onNavigate} />
              ))}
            </nav>
          </div>
        )}
      </>
    );
  }

  const userFooter = (
    <div className="border-t border-line px-4 py-3 text-xs">
      <p className="truncate font-medium text-ink">
        {me.user.firstName} {me.user.lastName}
      </p>
      <p className="truncate text-muted">{me.user.email}</p>
      <button
        onClick={logout}
        disabled={loggingOut}
        className="lt-focus mt-2 text-brand-600 hover:underline"
      >
        {loggingOut ? "Signing out…" : "Sign out"}
      </button>
    </div>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[15rem_1fr]">
      {/* Desktop sidebar — always visible at lg+, primary/secondary split. */}
      <aside className="hidden border-r border-line bg-white lg:flex lg:flex-col">
        <div className="flex items-center gap-2 px-5 py-4">
          <div className="grid h-7 w-7 place-items-center rounded-md bg-brand-600 text-sm font-bold text-white">
            L
          </div>
          <span className="text-sm font-semibold tracking-tight">LoadTopia</span>
        </div>

        {companySwitcher("desktop")}

        {showPostLoadCta && (
          <div className="px-3 pb-2">
            <Link
              href="/loads/new"
              className="lt-focus flex items-center justify-center rounded-lg bg-brand-600 px-3.5 py-2.5 text-sm font-medium text-white hover:bg-brand-700"
            >
              + Post a Load
            </Link>
          </div>
        )}

        <div className="flex-1 overflow-y-auto pb-4">{navSections()}</div>

        {userFooter}
      </aside>

      {/* Mobile top bar — replaces the old horizontal-scroll-only nav. */}
      <header className="flex items-center justify-between gap-2 border-b border-line bg-white px-4 py-3 lg:hidden">
        <Link href="/dashboard" className="flex items-center gap-2">
          <div className="grid h-7 w-7 place-items-center rounded-md bg-brand-600 text-sm font-bold text-white">
            L
          </div>
          <span className="text-sm font-semibold tracking-tight">LoadTopia</span>
        </Link>
        <div className="flex items-center gap-2">
          {showPostLoadCta && (
            <Link
              href="/loads/new"
              className="lt-focus rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              + Post
            </Link>
          )}
          <button
            type="button"
            aria-expanded={menuOpen}
            aria-controls="mobile-nav-panel"
            onClick={() => setMenuOpen((o) => !o)}
            className="lt-focus rounded-lg border border-line p-2.5 text-slate-600 hover:bg-slate-50"
          >
            <span className="sr-only">{menuOpen ? "Close menu" : "Open menu"}</span>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              {menuOpen ? (
                <path
                  d="M5 5l10 10M15 5L5 15"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                />
              ) : (
                <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
              )}
            </svg>
          </button>
        </div>
      </header>

      {/* Mobile nav panel — a plain disclosure region (not a modal), so it
          needs no focus trap: the trigger stays in normal tab order and
          Escape/outside-click are not required for a page-level menu. */}
      {menuOpen && (
        <div id="mobile-nav-panel" className="border-b border-line bg-white pb-2 lg:hidden">
          {companySwitcher("mobile")}
          {navSections(() => setMenuOpen(false))}
          {userFooter}
        </div>
      )}

      <main className="mx-auto w-full max-w-5xl px-5 py-8">
        {active && (
          <p className="mb-4 text-xs text-muted lg:hidden">
            {active.companyName} · signed in as {me.user.email}
          </p>
        )}
        {children}
      </main>
    </div>
  );
}
