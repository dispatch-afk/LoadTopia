import { Prisma } from "@loadtopia/db";

/**
 * All monetary values are handled as exact decimals — Prisma `Decimal`
 * (decimal.js) for arithmetic/comparison, decimal strings on the wire. A JS
 * `number` is never used to store or compare money.
 */
export type Decimal = Prisma.Decimal;

export function toDecimal(value: string | Prisma.Decimal): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

/** Canonical wire form: fixed 2 decimal places. */
export function money(value: Prisma.Decimal | string): string {
  return new Prisma.Decimal(value).toFixed(2);
}

export function moneyOrNull(value: Prisma.Decimal | null): string | null {
  return value === null ? null : value.toFixed(2);
}

export function ratePerMile(value: Prisma.Decimal | null): string | null {
  return value === null ? null : value.toFixed(4);
}
