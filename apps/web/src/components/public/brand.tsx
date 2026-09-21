import Link from "next/link";
import { cn } from "@/lib/format";

/**
 * Milestone 4 — public site brand mark. The current square+"L" treatment is
 * explicitly PROVISIONAL (not a final logo) — this component exists so the
 * mark can be swapped for a real logo asset in one place later, without
 * touching layout. Deliberately scoped to the public site only; the
 * existing authenticated app shell and auth-card layout keep their own
 * inline markup unchanged (out of scope for this phase).
 */
export function Brand({
  size = "md",
  href = "/",
  className,
}: {
  size?: "sm" | "md" | "lg";
  href?: string;
  className?: string;
}) {
  const box = size === "lg" ? "h-10 w-10 text-lg" : size === "sm" ? "h-7 w-7 text-sm" : "h-8 w-8 text-sm";
  const text = size === "lg" ? "text-xl" : size === "sm" ? "text-sm" : "text-lg";
  return (
    <Link href={href} className={cn("flex items-center gap-2", className)}>
      <div className={cn("grid place-items-center rounded-lg bg-brand-600 font-bold text-white", box)}>
        L
      </div>
      <span className={cn("font-semibold tracking-tight text-ink", text)}>LoadTopia</span>
    </Link>
  );
}
