/**
 * Rate Confirmation PDF renderer.
 *
 * Deterministic, dependency-free, server-side. The SAME immutable snapshot
 * rendered twice produces BYTE-IDENTICAL output: the document carries no
 * creation date, no random ids, and no ambient state — every byte is a pure
 * function of the model passed in. Storage-key idempotency (see
 * `rate-confirmation.snapshot.ts`) does not depend on this, but it makes a
 * crash-and-retry provably a no-op.
 *
 * This renders ONLY the authoritative commercial facts LoadTopia actually
 * holds. It never emits cancellation fees, detention/layover/lumper terms,
 * insurance or payment terms, quick-pay, indemnification, governing law, or a
 * signature block — a Rate Confirmation here is a commercial snapshot, not a
 * generated legal contract.
 *
 * Standard-14 fonts (Helvetica / Helvetica-Bold) are used, so no font file is
 * embedded and no external asset is required.
 */

/** The exact fields the renderer reads. A Prisma `RateConfirmation` row is
 *  structurally assignable to this (`Decimal` satisfies `{ toFixed }`). */
export interface RateConfirmationDocModel {
  referenceNumber: string;
  awardedAt: Date;
  agreedRate: { toFixed(digits: number): string };
  currency: string;
  distanceMeters: number | null;

  shipperCompanyName: string;
  shipperMcNumber: string | null;
  shipperDotNumber: string | null;

  carrierCompanyName: string;
  carrierLegalName: string | null;
  carrierMcNumber: string | null;
  carrierDotNumber: string | null;

  originAddressLine1: string;
  originAddressLine2: string | null;
  originCity: string;
  originState: string;
  originPostalCode: string;
  originCountry: string;

  destinationAddressLine1: string;
  destinationAddressLine2: string | null;
  destinationCity: string;
  destinationState: string;
  destinationPostalCode: string;
  destinationCountry: string;

  pickupWindowStart: Date | null;
  pickupWindowEnd: Date | null;
  deliveryWindowStart: Date | null;
  deliveryWindowEnd: Date | null;

  equipmentType: string;
  commodity: string | null;
  weightLbs: number | null;
}

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const LEFT = 54;
const RIGHT = PAGE_WIDTH - 54;
const TOP = 738;

type FontName = "F1" | "F2"; // F1 = Helvetica, F2 = Helvetica-Bold

interface Line {
  kind: "title" | "heading" | "row" | "rule" | "gap";
  label?: string;
  value?: string;
}

const METERS_PER_MILE = 1609.344;

function fmtInstant(d: Date): string {
  // Stable, locale-independent: "2026-09-05 14:07 UTC".
  const iso = d.toISOString(); // 2026-09-05T14:07:03.000Z
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

function fmtWindow(start: Date | null, end: Date | null): string {
  if (!start && !end) return "Not specified";
  if (start && end) return `${fmtInstant(start)}  to  ${fmtInstant(end)}`;
  return fmtInstant((start ?? end) as Date);
}

function fmtAddress(
  line1: string,
  line2: string | null,
  city: string,
  state: string,
  postal: string,
  country: string,
): string {
  const street = line2 ? `${line1}, ${line2}` : line1;
  return `${street}, ${city}, ${state} ${postal} ${country}`.trim();
}

function orDash(v: string | null | undefined): string {
  return v == null || v === "" ? "-" : v;
}

/** Locale-independent thousands grouping — keeps rendering deterministic
 *  regardless of the runtime's ICU data. */
function groupThousands(n: number): string {
  const neg = n < 0;
  const digits = Math.abs(Math.trunc(n)).toString();
  let out = "";
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ",";
    out += digits[i];
  }
  return neg ? "-" + out : out;
}

function buildLines(m: RateConfirmationDocModel): Line[] {
  const miles = m.distanceMeters == null ? null : Math.round(m.distanceMeters / METERS_PER_MILE);
  const lines: Line[] = [
    { kind: "title", value: "LoadTopia Rate Confirmation" },
    { kind: "row", label: "Confirmation #", value: m.referenceNumber },
    { kind: "row", label: "Agreement established", value: fmtInstant(m.awardedAt) },
    { kind: "rule" },

    { kind: "heading", value: "Shipper" },
    { kind: "row", label: "Company", value: m.shipperCompanyName },
    { kind: "row", label: "MC number", value: orDash(m.shipperMcNumber) },
    { kind: "row", label: "DOT number", value: orDash(m.shipperDotNumber) },
    { kind: "gap" },

    { kind: "heading", value: "Carrier" },
    { kind: "row", label: "Company", value: m.carrierCompanyName },
    { kind: "row", label: "Legal name", value: orDash(m.carrierLegalName) },
    { kind: "row", label: "MC number", value: orDash(m.carrierMcNumber) },
    { kind: "row", label: "DOT number", value: orDash(m.carrierDotNumber) },
    { kind: "rule" },

    { kind: "heading", value: "Shipment" },
    {
      kind: "row",
      label: "Origin",
      value: fmtAddress(
        m.originAddressLine1,
        m.originAddressLine2,
        m.originCity,
        m.originState,
        m.originPostalCode,
        m.originCountry,
      ),
    },
    {
      kind: "row",
      label: "Destination",
      value: fmtAddress(
        m.destinationAddressLine1,
        m.destinationAddressLine2,
        m.destinationCity,
        m.destinationState,
        m.destinationPostalCode,
        m.destinationCountry,
      ),
    },
    {
      kind: "row",
      label: "Pickup window",
      value: fmtWindow(m.pickupWindowStart, m.pickupWindowEnd),
    },
    {
      kind: "row",
      label: "Delivery window",
      value: fmtWindow(m.deliveryWindowStart, m.deliveryWindowEnd),
    },
    { kind: "row", label: "Equipment", value: m.equipmentType },
    { kind: "row", label: "Commodity", value: orDash(m.commodity) },
    {
      kind: "row",
      label: "Weight",
      value: m.weightLbs == null ? "-" : `${groupThousands(m.weightLbs)} lbs`,
    },
    { kind: "row", label: "Distance", value: miles == null ? "-" : `${groupThousands(miles)} mi` },
    { kind: "rule" },

    { kind: "heading", value: "Agreed carrier pay" },
    {
      kind: "row",
      label: "Total",
      value: `${m.agreedRate.toFixed(2)} ${m.currency}`,
    },
    { kind: "gap" },
    {
      kind: "row",
      label: "",
      value: "This document is a system-generated record of the commercial terms established",
    },
    {
      kind: "row",
      label: "",
      value: "when the winning offer was accepted on LoadTopia. It is not a contract amendment.",
    },
  ];
  return lines;
}

/** Escape a string for a PDF literal `( … )`. WinAnsi/Latin-1 range only —
 *  anything outside becomes '?', keeping the output pure single-byte. */
function pdfString(s: string): string {
  let out = "";
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (ch === "(" || ch === ")" || ch === "\\") out += "\\" + ch;
    else if (code < 32 || code > 255) out += "?";
    else out += ch;
  }
  return out;
}

function clamp(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 3) + "...";
}

function buildContentStream(lines: Line[]): string {
  const parts: string[] = [];
  let y = TOP;
  const emit = (font: FontName, size: number, x: number, text: string) => {
    parts.push(
      `BT /${font} ${size} Tf 1 0 0 1 ${x} ${y} Tm (${pdfString(clamp(text, 118))}) Tj ET`,
    );
  };
  for (const ln of lines) {
    if (ln.kind === "gap") {
      y -= 8;
      continue;
    }
    if (ln.kind === "rule") {
      y -= 6;
      parts.push(`0.75 w ${LEFT} ${y} m ${RIGHT} ${y} l S`);
      y -= 14;
      continue;
    }
    if (ln.kind === "title") {
      emit("F2", 20, LEFT, ln.value ?? "");
      y -= 30;
      continue;
    }
    if (ln.kind === "heading") {
      y -= 2;
      emit("F2", 12, LEFT, ln.value ?? "");
      y -= 18;
      continue;
    }
    // row
    if (ln.label) emit("F2", 9.5, LEFT, ln.label);
    emit("F1", 10, LEFT + 108, ln.value ?? "");
    y -= 16;
  }
  return parts.join("\n");
}

/**
 * Render `model` to a complete PDF document. Pure and deterministic: identical
 * input yields byte-identical output.
 */
export function renderRateConfirmationPdf(model: RateConfirmationDocModel): Uint8Array {
  const content = buildContentStream(buildLines(model));
  const contentBytes = Buffer.from(content, "latin1");

  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      `/Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${contentBytes.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
  ];

  const chunks: Buffer[] = [];
  let offset = 0;
  const push = (s: string | Buffer) => {
    const b = typeof s === "string" ? Buffer.from(s, "latin1") : s;
    chunks.push(b);
    offset += b.length;
  };

  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");

  const xref: number[] = [];
  objects.forEach((body, i) => {
    xref[i] = offset;
    push(`${i + 1} 0 obj\n${body}\nendobj\n`);
  });

  const xrefOffset = offset;
  const n = objects.length + 1;
  let table = `xref\n0 ${n}\n0000000000 65535 f \n`;
  for (const o of xref) table += `${String(o).padStart(10, "0")} 00000 n \n`;
  push(table);
  push(`trailer\n<< /Size ${n} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  return Buffer.concat(chunks);
}
