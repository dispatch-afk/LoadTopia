"use client";

import Link from "next/link";
import type { CarrierGroupView, CompanyProfileView, CompanyType } from "@loadtopia/shared";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { fmtDate, titleCase } from "@/lib/format";
import { CONNECTION_STATUS_LABEL, CONNECTION_STATUS_TONE } from "@/lib/status-tone";
import { counterpartNoun, laneLabel, sharedHistoryHeadline } from "@/lib/network";
import { BlockControl } from "./block-control";
import { ConnectToggle } from "./connect-toggle";
import { ConnectionActions } from "./connection-actions";
import { FollowToggle } from "./follow-toggle";
import { GroupMembershipControl } from "./group-membership-control";
import { PreferenceControl } from "./preference-control";

const CONNECTION_EVENT_LABEL: Record<string, string> = {
  REQUESTED: "Connection requested",
  ACCEPTED: "Connected",
  DECLINED: "Declined",
  DISCONNECTED: "Disconnected",
};

export function CompanyProfile({
  myCompanyId,
  myCompanyType,
  canManage,
  profile,
  allGroups,
}: {
  myCompanyId: string | null;
  myCompanyType: CompanyType | null;
  canManage: boolean;
  profile: CompanyProfileView;
  allGroups: CarrierGroupView[];
}) {
  const isSelf = myCompanyId === profile.id;
  const noun = counterpartNoun(myCompanyType);
  const { connection } = profile.relationship;

  const headline = sharedHistoryHeadline(profile.sharedHistory);
  const memberGroupIds = profile.relationship.groups?.map((g) => g.id) ?? [];

  return (
    <div>
      <PageHeader
        title={profile.name}
        subtitle={`${titleCase(profile.type)}${profile.city ? ` · ${profile.city}, ${profile.state}` : ""} · LoadTopia member since ${fmtDate(profile.memberSince)}`}
        action={
          connection && (
            <Badge tone={CONNECTION_STATUS_TONE[connection.status]}>
              {CONNECTION_STATUS_LABEL[connection.status]}
            </Badge>
          )
        }
      />

      {!isSelf && (
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <ConnectToggle companyId={profile.id} connection={connection} counterpartNoun={noun} />
          {myCompanyType === "CARRIER" && profile.type === "SHIPPER" && profile.relationship.isFollowing !== null && (
            <FollowToggle shipperCompanyId={profile.id} initiallyFollowing={profile.relationship.isFollowing} />
          )}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {profile.capabilities && (
            <Card className="p-5">
              <h2 className="mb-4 text-sm font-semibold text-ink">Capabilities</h2>
              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted">Legal name</dt>
                  <dd className="mt-0.5 text-sm text-ink">{profile.capabilities.legalName}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted">Equipment</dt>
                  <dd className="mt-0.5 text-sm text-ink">
                    {profile.capabilities.equipmentTypes.length > 0
                      ? profile.capabilities.equipmentTypes.map(titleCase).join(", ")
                      : "Not specified"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted">Service area</dt>
                  <dd className="mt-0.5 text-sm text-ink">
                    {profile.capabilities.serviceAreaStates.length > 0
                      ? profile.capabilities.serviceAreaStates.join(", ")
                      : "Nationwide"}
                  </dd>
                </div>
              </dl>
            </Card>
          )}

          {!isSelf && (
            <Card className="p-5">
              <h2 className="mb-4 text-sm font-semibold text-ink">Our relationship</h2>
              {headline ? (
                <p className="text-sm text-ink">{headline}</p>
              ) : (
                <p className="text-sm text-muted">No verified shared freight yet.</p>
              )}
              {profile.sharedHistory.activeShipments > 0 && (
                <p className="mt-1 text-sm text-ink">
                  {profile.sharedHistory.activeShipments} shipment
                  {profile.sharedHistory.activeShipments === 1 ? "" : "s"} currently in progress
                </p>
              )}
              {profile.sharedHistory.lastWorkedTogether && (
                <p className="mt-1 text-xs text-muted">
                  Last worked together {fmtDate(profile.sharedHistory.lastWorkedTogether)}
                </p>
              )}

              {profile.sharedHistory.recentLanes.length > 0 && (
                <div className="mt-4 border-t border-line pt-4">
                  <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
                    Shared freight
                  </h3>
                  <ul className="space-y-2">
                    {profile.sharedHistory.recentLanes.map((lane) => (
                      <li key={lane.loadId} className="text-sm">
                        <Link
                          href={`/loads/${lane.loadId}`}
                          className="font-medium text-brand-600 hover:underline"
                        >
                          {lane.referenceNumber}
                        </Link>{" "}
                        <span className="text-ink">{laneLabel(lane)}</span>
                        <span className="ml-2 text-muted">
                          {titleCase(lane.status)} · {fmtDate(lane.awardedAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>
          )}

          {!isSelf && connection && profile.relationship.connectionEvents.length > 0 && (
            <Card className="p-5">
              <h2 className="mb-4 text-sm font-semibold text-ink">Connection history</h2>
              <ol className="space-y-2 border-l border-line pl-3">
                {profile.relationship.connectionEvents.map((e) => (
                  <li key={e.id} className="text-sm text-ink">
                    {CONNECTION_EVENT_LABEL[e.type] ?? titleCase(e.type)}
                    <span className="ml-2 text-xs text-muted">{fmtDate(e.createdAt)}</span>
                  </li>
                ))}
              </ol>
            </Card>
          )}
        </div>

        {!isSelf && (
          <div className="space-y-6">
            <Card className="p-5">
              <h2 className="mb-3 text-sm font-semibold text-ink">Relationship controls</h2>
              <div className="space-y-4">
                {connection ? (
                  <ConnectionActions connection={connection} canManage={canManage} counterpartNoun={noun} />
                ) : (
                  <p className="text-sm text-muted">No connection yet.</p>
                )}
                {myCompanyType === "SHIPPER" && profile.type === "CARRIER" && (
                  <>
                    <div className="border-t border-line pt-4">
                      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
                        Private preference
                      </h3>
                      <PreferenceControl
                        carrierCompanyId={profile.id}
                        canManage={canManage}
                        initialPreference={profile.relationship.preference}
                      />
                    </div>
                    <div className="border-t border-line pt-4">
                      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
                        Carrier Groups
                      </h3>
                      <GroupMembershipControl
                        carrierCompanyId={profile.id}
                        canManage={canManage}
                        allGroups={allGroups}
                        initialMemberGroupIds={memberGroupIds}
                      />
                    </div>
                  </>
                )}
              </div>
            </Card>

            <BlockControl companyId={profile.id} canManage={canManage} initialStatus={profile.relationship.blockStatus} />
          </div>
        )}
      </div>

      {isSelf && (
        <EmptyState
          title="This is your own company"
          description="Relationship tools apply only to other companies."
        />
      )}
    </div>
  );
}
