"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import type { MeResponse } from "@loadtopia/shared";
import { apiClient } from "@/lib/api-client";
import { cn } from "@/lib/format";
import { Spinner } from "./ui";

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/loads", label: "Loads" },
  { href: "/locations", label: "Locations" },
  { href: "/equipment", label: "Equipment" },
  { href: "/settings/company", label: "Company" },
  { href: "/settings/members", label: "Team" },
];

export function AppShell({ me, children }: { me: MeResponse; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const active = me.memberships.find((m) => m.companyId === me.activeCompanyId);
  const [switching, setSwitching] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  async function switchCompany(companyId: string) {
    if (companyId === me.activeCompanyId) return;
    setSwitching(true);
    try {
      await apiClient("/auth/switch-company", {
        method: "POST",
        body: JSON.stringify({ companyId }),
      });
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

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[15rem_1fr]">
      <aside className="border-b border-line bg-white lg:border-b-0 lg:border-r">
        <div className="flex items-center gap-2 px-5 py-4">
          <div className="grid h-7 w-7 place-items-center rounded-md bg-brand-600 text-sm font-bold text-white">
            L
          </div>
          <span className="text-sm font-semibold tracking-tight">LoadTopia</span>
        </div>

        <div className="px-3 pb-2">
          <label className="mb-1 block px-2 text-[0.7rem] font-medium uppercase tracking-wide text-muted">
            Active company
          </label>
          <div className="relative">
            <select
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

        <nav className="flex gap-1 overflow-x-auto px-3 py-2 lg:flex-col">
          {NAV.map((item) => {
            const isActive =
              pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "lt-focus whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition",
                  isActive
                    ? "bg-brand-50 text-brand-700"
                    : "text-slate-600 hover:bg-slate-50 hover:text-ink",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto hidden border-t border-line px-4 py-3 text-xs lg:block">
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
      </aside>

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
