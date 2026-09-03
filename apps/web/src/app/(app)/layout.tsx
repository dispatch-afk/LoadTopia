import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { requireMe } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const me = await requireMe();
  return <AppShell me={me}>{children}</AppShell>;
}
