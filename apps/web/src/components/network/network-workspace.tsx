"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type {
  CarrierFollowView,
  CarrierPreferenceType,
  CompanyType,
  ConnectionView,
} from "@loadtopia/shared";
import { Badge, Button, EmptyState, Input, PageHeader } from "@/components/ui";
import { Tab, TabList, TabPanel, Tabs } from "@/components/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/table";
import { fmtDate } from "@/lib/format";
import { CONNECTION_STATUS_LABEL, CONNECTION_STATUS_TONE } from "@/lib/status-tone";
import { networkAreaLabel, sharedHistoryHeadline } from "@/lib/network";

const PREFERENCE_LABEL: Record<CarrierPreferenceType, string> = {
  PREFER: "Prefer",
  DO_NOT_PREFER: "Do Not Prefer",
};

function matches(name: string, query: string): boolean {
  return name.toLowerCase().includes(query.trim().toLowerCase());
}

function RelationshipRow({
  connection,
  companyType,
  preference,
}: {
  connection: ConnectionView;
  companyType: CompanyType | null;
  preference?: CarrierPreferenceType;
}) {
  const headline = sharedHistoryHeadline(connection.sharedHistory);
  return (
    <div className="rounded-xl border border-line bg-white p-4 md:hidden">
      <div className="flex items-start justify-between gap-2">
        <Link
          href={`/network/companies/${connection.counterpartCompanyId}`}
          className="font-medium text-brand-600 hover:underline"
        >
          {connection.counterpartCompanyName}
        </Link>
        <Badge tone={CONNECTION_STATUS_TONE[connection.status]}>{CONNECTION_STATUS_LABEL[connection.status]}</Badge>
      </div>
      <p className="mt-1 text-sm text-muted">{headline || "No verified shared freight yet"}</p>
      {connection.sharedHistory.lastWorkedTogether && (
        <p className="text-xs text-muted">Last worked together {fmtDate(connection.sharedHistory.lastWorkedTogether)}</p>
      )}
      {preference && companyType === "SHIPPER" && (
        <p className="mt-1 text-xs text-ink">{PREFERENCE_LABEL[preference]}</p>
      )}
      {connection.awaitingMyResponse && (
        <p className="mt-2 text-xs font-medium text-brand-700">Action needed — review this request</p>
      )}
    </div>
  );
}

function RelationshipTable({
  rows,
  companyType,
  preferences,
}: {
  rows: ConnectionView[];
  companyType: CompanyType | null;
  preferences: Map<string, CarrierPreferenceType>;
}) {
  const counterpartLabel = companyType === "CARRIER" ? "Shipper" : "Carrier";
  const showPreference = companyType === "SHIPPER";

  return (
    <>
      <div className="hidden md:block">
        <Table>
          <TableHead>
            <tr>
              <TableHeaderCell>{counterpartLabel}</TableHeaderCell>
              <TableHeaderCell>Relationship</TableHeaderCell>
              <TableHeaderCell>Verified shared freight</TableHeaderCell>
              <TableHeaderCell>Last worked together</TableHeaderCell>
              {showPreference && <TableHeaderCell>Private preference</TableHeaderCell>}
            </tr>
          </TableHead>
          <TableBody>
            {rows.map((c) => (
              <TableRow key={c.id}>
                <TableCell>
                  <Link
                    href={`/network/companies/${c.counterpartCompanyId}`}
                    className="font-medium text-brand-600 hover:underline"
                  >
                    {c.counterpartCompanyName}
                  </Link>
                  {c.awaitingMyResponse && (
                    <span className="ml-2">
                      <Badge tone="indigo">Action needed</Badge>
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge tone={CONNECTION_STATUS_TONE[c.status]}>{CONNECTION_STATUS_LABEL[c.status]}</Badge>
                </TableCell>
                <TableCell className="text-muted">
                  {sharedHistoryHeadline(c.sharedHistory) || "—"}
                </TableCell>
                <TableCell className="text-muted">
                  {c.sharedHistory.lastWorkedTogether ? fmtDate(c.sharedHistory.lastWorkedTogether) : "—"}
                </TableCell>
                {showPreference && (
                  <TableCell className="text-muted">
                    {preferences.has(c.counterpartCompanyId)
                      ? PREFERENCE_LABEL[preferences.get(c.counterpartCompanyId)!]
                      : "—"}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="space-y-3 md:hidden">
        {rows.map((c) => (
          <RelationshipRow
            key={c.id}
            connection={c}
            companyType={companyType}
            preference={preferences.get(c.counterpartCompanyId)}
          />
        ))}
      </div>
    </>
  );
}

export function NetworkWorkspace({
  companyType,
  connections,
  follows,
  preferences,
}: {
  companyType: CompanyType | null;
  connections: ConnectionView[];
  follows: CarrierFollowView[];
  preferences: Map<string, CarrierPreferenceType>;
}) {
  const [tab, setTab] = useState<"connected" | "requests" | "following">("connected");
  const [query, setQuery] = useState("");
  const isCarrier = companyType === "CARRIER";
  const label = networkAreaLabel(companyType);

  const connected = useMemo(() => connections.filter((c) => c.status === "ACCEPTED"), [connections]);
  const requests = useMemo(() => connections.filter((c) => c.status === "PENDING"), [connections]);
  const actionNeeded = requests.filter((r) => r.awaitingMyResponse).length;

  const filteredConnected = connected.filter((c) => matches(c.counterpartCompanyName, query));
  const filteredRequests = requests.filter((c) => matches(c.counterpartCompanyName, query));
  const filteredFollows = follows.filter((f) => matches(f.shipperCompanyName, query));

  return (
    <div>
      <PageHeader
        title={label}
        subtitle={
          isCarrier
            ? "Shippers you've built relationships with, and requests awaiting a response."
            : "Carriers you've built relationships with, and requests awaiting a response."
        }
        action={
          !isCarrier && (
            <Link href="/network/groups">
              <Button variant="secondary">Carrier Groups</Button>
            </Link>
          )
        }
      />

      <div className="mb-4 max-w-sm">
        <Input
          type="search"
          placeholder={`Search ${isCarrier ? "shippers" : "carriers"}`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={`Search ${isCarrier ? "shippers" : "carriers"} by name`}
        />
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabList label="Network views">
          <Tab value="connected">Connected ({connected.length})</Tab>
          <Tab value="requests">
            Requests ({requests.length}){actionNeeded > 0 && <span className="ml-1.5"><Badge tone="indigo">{actionNeeded}</Badge></span>}
          </Tab>
          {isCarrier && <Tab value="following">Following ({follows.length})</Tab>}
        </TabList>

        <TabPanel value="connected">
          {filteredConnected.length === 0 ? (
            <EmptyState
              title={
                query
                  ? "No matches"
                  : isCarrier
                    ? "You haven't connected with any shippers yet."
                    : "You haven't connected with any carriers yet."
              }
            />
          ) : (
            <RelationshipTable rows={filteredConnected} companyType={companyType} preferences={preferences} />
          )}
        </TabPanel>

        <TabPanel value="requests">
          {filteredRequests.length === 0 ? (
            <EmptyState title={query ? "No matches" : "No connection requests need your attention."} />
          ) : (
            <RelationshipTable rows={filteredRequests} companyType={companyType} preferences={preferences} />
          )}
        </TabPanel>

        {isCarrier && (
          <TabPanel value="following">
            {filteredFollows.length === 0 ? (
              <EmptyState title={query ? "No matches" : "You aren't following any shippers yet."} />
            ) : (
              <div className="space-y-2">
                {filteredFollows.map((f) => (
                  <div
                    key={f.id}
                    className="flex items-center justify-between rounded-xl border border-line bg-white p-4"
                  >
                    <Link
                      href={`/network/companies/${f.shipperCompanyId}`}
                      className="font-medium text-brand-600 hover:underline"
                    >
                      {f.shipperCompanyName}
                    </Link>
                    <span className="text-xs text-muted">Since {fmtDate(f.createdAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </TabPanel>
        )}
      </Tabs>
    </div>
  );
}
