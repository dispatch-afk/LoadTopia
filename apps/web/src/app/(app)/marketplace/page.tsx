import Link from "next/link";
import { EQUIPMENT_TYPES, type MarketplaceLoadListItem, type Paginated } from "@loadtopia/shared";
import { ApiError, apiServer } from "@/lib/api-server";
import { Alert, Badge, Button, EmptyState, Field, Input, PageHeader, Select } from "@/components/ui";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/table";
import { isYourMove, MarketplaceCard } from "@/components/marketplace/marketplace-card";
import { fmtMiles, fmtMoney, fmtWeight, fmtWindow, titleCase } from "@/lib/format";

export const dynamic = "force-dynamic";

const SORTS = [
  { key: "newest", label: "Newest" },
  { key: "pickup", label: "Pickup date" },
  { key: "miles", label: "Distance" },
] as const;

interface MarketplaceSearchParams {
  page?: string;
  sort?: string;
  originState?: string;
  destinationState?: string;
  equipmentType?: string;
  pickupFrom?: string;
  pickupTo?: string;
}

/** Plain YYYY-MM-DD (what a native `<input type="date">` produces/accepts) —
 *  kept as the URL's own representation for a clean, bookmarkable filter
 *  state. Converted to a full ISO datetime only when calling the API,
 *  which requires an offset-bearing datetime (Milestone 4 Phase 10 §17 —
 *  reuse the existing schema's expectations, never invent a new one). */
function toStartOfDayIso(date: string): string {
  return `${date}T00:00:00.000Z`;
}
function toEndOfDayIso(date: string): string {
  return `${date}T23:59:59.999Z`;
}

function buildHref(current: MarketplaceSearchParams, overrides: Partial<MarketplaceSearchParams>): string {
  const merged = { ...current, ...overrides };
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) {
    if (v) params.set(k, v);
  }
  const qs = params.toString();
  return qs ? `/marketplace?${qs}` : "/marketplace";
}

export default async function MarketplacePage({
  searchParams,
}: {
  searchParams: Promise<MarketplaceSearchParams>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? "1") || 1);
  const sort = SORTS.some((s) => s.key === sp.sort) ? sp.sort! : "newest";
  const originState = sp.originState?.trim() || undefined;
  const destinationState = sp.destinationState?.trim() || undefined;
  const equipmentType = sp.equipmentType || undefined;
  const pickupFrom = sp.pickupFrom || undefined;
  const pickupTo = sp.pickupTo || undefined;
  const hasFilters = Boolean(originState || destinationState || equipmentType || pickupFrom || pickupTo);

  let result: Paginated<MarketplaceLoadListItem>;
  try {
    result = await apiServer<Paginated<MarketplaceLoadListItem>>("/api/marketplace/loads", {
      query: {
        page,
        pageSize: 20,
        sort,
        originState,
        destinationState,
        equipmentType,
        pickupFrom: pickupFrom ? toStartOfDayIso(pickupFrom) : undefined,
        pickupTo: pickupTo ? toEndOfDayIso(pickupTo) : undefined,
      },
    });
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) {
      return (
        <div>
          <PageHeader title="Marketplace" subtitle="Available freight" />
          <Alert tone="info">
            Your company is not yet eligible to browse the marketplace. Complete your{" "}
            <Link href="/settings/carrier-profile" className="font-medium underline">
              carrier profile
            </Link>{" "}
            and run verification, or wait for a LoadTopia review.
          </Alert>
        </div>
      );
    }
    throw err;
  }

  return (
    <div>
      <PageHeader
        title="Marketplace"
        subtitle="Freight matched to your equipment and service area. Server-filtered."
      />

      <form action="/marketplace" method="get" className="mb-4 rounded-xl border border-line bg-white p-4">
        <input type="hidden" name="sort" value={sort} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Origin state">
            <Input name="originState" defaultValue={originState ?? ""} maxLength={2} placeholder="e.g. TX" />
          </Field>
          <Field label="Destination state">
            <Input
              name="destinationState"
              defaultValue={destinationState ?? ""}
              maxLength={2}
              placeholder="e.g. GA"
            />
          </Field>
          <Field label="Equipment">
            <Select name="equipmentType" defaultValue={equipmentType ?? ""}>
              <option value="">Any</option>
              {EQUIPMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {titleCase(t)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Pickup from">
            <Input type="date" name="pickupFrom" defaultValue={pickupFrom ?? ""} />
          </Field>
          <Field label="Pickup to">
            <Input type="date" name="pickupTo" defaultValue={pickupTo ?? ""} />
          </Field>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <Button type="submit">Apply filters</Button>
          {hasFilters && (
            <Link href={`/marketplace?sort=${sort}`} className="text-sm text-brand-600 hover:underline">
              Clear filters
            </Link>
          )}
        </div>
      </form>

      <div className="mb-4 flex flex-wrap gap-1.5">
        {SORTS.map((s) => (
          <Link
            key={s.key}
            href={buildHref(sp, { sort: s.key, page: undefined })}
            className={
              "rounded-full border px-3 py-1 text-sm font-medium transition " +
              (sort === s.key
                ? "border-brand-600 bg-brand-600 text-white"
                : "border-line bg-white text-slate-600 hover:bg-brand-50")
            }
          >
            {s.label}
          </Link>
        ))}
      </div>

      {result.data.length === 0 ? (
        <EmptyState
          title={hasFilters ? "No freight matches these filters" : "No matching loads"}
          description={
            hasFilters
              ? "Try widening your filters or check back soon."
              : "Nothing on the board matches your carrier profile right now. Check back soon."
          }
        />
      ) : (
        <>
          <div className="hidden md:block">
            <Table>
              <TableHead>
                <tr>
                  <TableHeaderCell>Ref</TableHeaderCell>
                  <TableHeaderCell>Lane</TableHeaderCell>
                  <TableHeaderCell>Pickup</TableHeaderCell>
                  <TableHeaderCell>Equipment</TableHeaderCell>
                  <TableHeaderCell>Weight</TableHeaderCell>
                  <TableHeaderCell>Miles</TableHeaderCell>
                  <TableHeaderCell>Rate</TableHeaderCell>
                  <TableHeaderCell>Shipper</TableHeaderCell>
                  <TableHeaderCell>My offer</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {result.data.map((l) => {
                  const yourMove = isYourMove(l);
                  return (
                    <TableRow key={l.id}>
                      <TableCell className="whitespace-nowrap font-medium">
                        <Link href={`/marketplace/${l.id}`} className="text-brand-600 hover:underline">
                          {l.referenceNumber}
                        </Link>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {l.origin.city}, {l.origin.state} → {l.destination.city}, {l.destination.state}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted">
                        {fmtWindow(l.pickupWindowStart, l.pickupWindowEnd)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{titleCase(l.equipmentType)}</TableCell>
                      <TableCell className="whitespace-nowrap">{fmtWeight(l.weightLbs)}</TableCell>
                      <TableCell>
                        <div className="whitespace-nowrap">{fmtMiles(l.miles)}</div>
                        {l.routing.isMock && (
                          <div className="text-xs text-muted">MOCK development data, not real-world routing</div>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {l.commercialMode === "PUBLISH_RATE" && l.postedRate ? (
                          <>
                            <span className="font-medium">{fmtMoney(l.postedRate)}</span>
                            {l.ratePerMile && (
                              <span className="ml-1 text-xs text-muted">${l.ratePerMile}/mi</span>
                            )}
                          </>
                        ) : (
                          <span className="text-muted">Requesting offers</span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted">
                        {l.shipperName}
                        {l.shipperIsConnected && (
                          <span className="ml-1.5">
                            <Badge tone="indigo">Connected</Badge>
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {yourMove ? (
                          <Badge tone="indigo">Your move</Badge>
                        ) : l.myThread ? (
                          <Badge tone={l.myThread.status === "ACTIVE" ? "amber" : "gray"}>
                            {titleCase(l.myThread.status)}
                          </Badge>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <div className="space-y-3 md:hidden">
            {result.data.map((l) => (
              <MarketplaceCard key={l.id} l={l} />
            ))}
          </div>
        </>
      )}

      {result.totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-muted">
          <span>
            Page {result.page} of {result.totalPages} · {result.total} loads
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link
                href={buildHref(sp, { page: String(page - 1) })}
                className="rounded-lg border border-line bg-white px-3 py-1.5 hover:bg-canvas"
              >
                Previous
              </Link>
            )}
            {page < result.totalPages && (
              <Link
                href={buildHref(sp, { page: String(page + 1) })}
                className="rounded-lg border border-line bg-white px-3 py-1.5 hover:bg-canvas"
              >
                Next
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
