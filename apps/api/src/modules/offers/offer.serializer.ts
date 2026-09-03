import type { Prisma } from "@loadtopia/db";
import { isExpired } from "@loadtopia/domain";
import type {
  OfferEventView,
  OfferRoundView,
  OfferThreadSummary,
  OfferThreadView,
} from "@loadtopia/shared";
import { money } from "../../lib/money";

export type ViewerParty = "CARRIER" | "SHIPPER" | "ADMIN";

export const threadSummaryInclude = {
  currentRound: { select: { amount: true, currency: true, expiresAt: true, proposedByCompanyId: true } },
  carrierCompany: { select: { id: true, name: true } },
  load: { select: { shipperCompanyId: true, status: true } },
} satisfies Prisma.OfferThreadInclude;

export const threadDetailInclude = {
  carrierCompany: { select: { id: true, name: true } },
  currentRound: true,
  load: {
    select: {
      id: true,
      referenceNumber: true,
      status: true,
      shipperCompanyId: true,
      equipmentType: true,
      shipperCompany: { select: { name: true } },
      origin: { select: { city: true, state: true } },
      destination: { select: { city: true, state: true } },
    },
  },
  rounds: {
    orderBy: { roundNumber: "asc" },
    include: { proposedByCompany: { select: { name: true } } },
  },
  events: {
    orderBy: { createdAt: "asc" },
    include: {
      actor: { select: { firstName: true, lastName: true } },
      actorCompany: { select: { id: true } },
    },
  },
} satisfies Prisma.OfferThreadInclude;

type SummaryRow = Prisma.OfferThreadGetPayload<{ include: typeof threadSummaryInclude }>;
type DetailRow = Prisma.OfferThreadGetPayload<{ include: typeof threadDetailInclude }>;

function partyOf(companyId: string, carrierCompanyId: string, shipperCompanyId: string) {
  if (companyId === carrierCompanyId) return "CARRIER" as const;
  if (companyId === shipperCompanyId) return "SHIPPER" as const;
  return "SYSTEM" as const;
}

export function toThreadSummary(t: SummaryRow, viewer: ViewerParty): OfferThreadSummary {
  const proposer = t.currentRound
    ? partyOf(t.currentRound.proposedByCompanyId, t.carrierCompanyId, t.load.shipperCompanyId)
    : null;
  const respondingParty = proposer === "CARRIER" ? "SHIPPER" : proposer === "SHIPPER" ? "CARRIER" : null;
  return {
    threadId: t.id,
    loadId: t.loadId,
    status: t.status,
    roundCount: t.roundCount,
    currentAmount: t.currentRound ? money(t.currentRound.amount) : null,
    currentCurrency: t.currentRound?.currency ?? "USD",
    currentExpiresAt: t.currentRound?.expiresAt.toISOString() ?? null,
    awaitingMyResponse:
      t.status === "ACTIVE" && respondingParty !== null && respondingParty === viewer,
    // Carrier identity is shown to the shipper (their negotiation) and admin — never to
    // another carrier (privacy is enforced by scoping, not by this field).
    carrier: viewer === "CARRIER" ? null : { companyId: t.carrierCompany.id, name: t.carrierCompany.name },
    updatedAt: t.updatedAt.toISOString(),
  };
}

function toRoundView(
  r: DetailRow["rounds"][number],
  carrierCompanyId: string,
  shipperCompanyId: string,
  now: Date,
): OfferRoundView {
  const party = partyOf(r.proposedByCompanyId, carrierCompanyId, shipperCompanyId);
  return {
    id: r.id,
    roundNumber: r.roundNumber,
    proposedByCompanyId: r.proposedByCompanyId,
    proposedByParty: party === "SYSTEM" ? "SHIPPER" : party,
    proposedByName: r.proposedByCompany.name,
    amount: money(r.amount),
    currency: r.currency,
    message: r.message,
    expiresAt: r.expiresAt.toISOString(),
    isExpired: isExpired(r.expiresAt, now),
    createdAt: r.createdAt.toISOString(),
  };
}

function toEventView(
  e: DetailRow["events"][number],
  carrierCompanyId: string,
  shipperCompanyId: string,
  viewer: ViewerParty,
): OfferEventView {
  const party = e.actorCompany
    ? partyOf(e.actorCompany.id, carrierCompanyId, shipperCompanyId)
    : "SYSTEM";
  // An individual's name is only shown to their own side (or admin). The other
  // party sees the acting side, never the person — no cross-boundary PII.
  const showName = viewer === "ADMIN" || party === viewer;
  return {
    id: e.id,
    type: e.type,
    actorUserId: showName ? e.actorUserId : null,
    actorName: showName && e.actor ? `${e.actor.firstName} ${e.actor.lastName}` : null,
    actorParty: party,
    createdAt: e.createdAt.toISOString(),
  };
}

export function toThreadView(t: DetailRow, viewer: ViewerParty, now: Date = new Date()): OfferThreadView {
  const shipperCompanyId = t.load.shipperCompanyId;
  const cur = t.currentRound;
  const proposer = cur ? partyOf(cur.proposedByCompanyId, t.carrierCompanyId, shipperCompanyId) : null;
  const respondingParty = proposer === "CARRIER" ? "SHIPPER" : proposer === "SHIPPER" ? "CARRIER" : null;
  const currentExpired = cur ? isExpired(cur.expiresAt, now) : true;
  const loadOnMarket = t.load.status === "POSTED" || t.load.status === "OFFER_RECEIVED";
  const negotiable = t.status === "ACTIVE" && !currentExpired && loadOnMarket;
  const iRespond = negotiable && respondingParty === viewer;

  const summary: OfferThreadSummary = {
    threadId: t.id,
    loadId: t.loadId,
    status: t.status,
    roundCount: t.roundCount,
    currentAmount: cur ? money(cur.amount) : null,
    currentCurrency: cur?.currency ?? "USD",
    currentExpiresAt: cur?.expiresAt.toISOString() ?? null,
    awaitingMyResponse: t.status === "ACTIVE" && respondingParty !== null && respondingParty === viewer,
    carrier: viewer === "CARRIER" ? null : { companyId: t.carrierCompany.id, name: t.carrierCompany.name },
    updatedAt: t.updatedAt.toISOString(),
  };

  return {
    ...summary,
    load: {
      id: t.load.id,
      referenceNumber: t.load.referenceNumber,
      status: t.load.status,
      origin: t.load.origin,
      destination: t.load.destination,
      equipmentType: t.load.equipmentType,
    },
    rounds: t.rounds.map((r) => toRoundView(r, t.carrierCompanyId, shipperCompanyId, now)),
    events: t.events.map((e) => toEventView(e, t.carrierCompanyId, shipperCompanyId, viewer)),
    actions: {
      canCounter: iRespond,
      canAccept: iRespond,
      canReject: negotiable && viewer === "SHIPPER",
      canWithdraw: negotiable && viewer === "CARRIER",
    },
  };
}
