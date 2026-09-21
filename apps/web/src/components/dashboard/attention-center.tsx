import Link from "next/link";
import { Card } from "@/components/ui";

export interface AttentionCenterEntry {
  key: string;
  label: string;
  count: number;
  href: string;
}

/**
 * Shared, role-aware Attention Center (Milestone 4 Phase 8). Purely
 * presentational — every count/label/link is resolved by the caller from
 * server-provided facts. Renders only non-zero items; a completely empty
 * set shows a calm, factual message rather than nothing, so the section
 * never silently disappears. Deliberately compact — never a wall of cards.
 */
export function AttentionCenter({ items }: { items: AttentionCenterEntry[] }) {
  const visible = items.filter((item) => item.count > 0);

  if (visible.length === 0) {
    return (
      <Card className="p-4 text-sm text-muted">Nothing needs your attention right now.</Card>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {visible.map((item) => (
        <Link key={item.key} href={item.href}>
          <Card className="p-4 transition hover:border-brand-200">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">{item.label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{item.count}</p>
          </Card>
        </Link>
      ))}
    </div>
  );
}
