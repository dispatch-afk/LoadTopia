import type { ReactNode, TableHTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "@/lib/format";

/**
 * Desktop-oriented, information-dense table primitives. Deliberately NOT a
 * "smart" component that reshapes itself for mobile — a table's information
 * hierarchy rarely survives being squeezed into a phone width unchanged.
 * Build an explicit mobile representation (e.g. a card list) alongside this,
 * the way `documents-panel.tsx` / `check-ins-panel.tsx` already do, rather
 * than expecting this component to do it automatically.
 */
export function Table({
  className,
  children,
  ...props
}: TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-white">
      <table className={cn("w-full border-collapse text-sm", className)} {...props}>
        {children}
      </table>
    </div>
  );
}

export function TableHead({ children }: { children: ReactNode }) {
  return <thead className="border-b border-line bg-canvas text-left">{children}</thead>;
}

export function TableBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-line">{children}</tbody>;
}

export function TableRow({ children, className }: { children: ReactNode; className?: string }) {
  return <tr className={cn("hover:bg-canvas/60", className)}>{children}</tr>;
}

export function TableHeaderCell({
  className,
  children,
  ...props
}: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn("px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-muted", className)}
      {...props}
    >
      {children}
    </th>
  );
}

export function TableCell({
  className,
  children,
  ...props
}: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={cn("px-4 py-3 align-top text-ink", className)} {...props}>
      {children}
    </td>
  );
}
