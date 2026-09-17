import type { CompanyType } from "@loadtopia/shared";

/**
 * Role-aware app-shell navigation (Milestone 4 Phase 11). Replaces the
 * earlier flat, undifferentiated nav list with explicit, locked primary
 * lists per company type plus one shared secondary/settings list.
 *
 * Visibility here is UX only — every item still requires the caller to
 * already hold `permission` (checked against `MeResponse.permissions`,
 * server-authoritative). Hiding a link is never itself an authorization
 * control; the API enforces access regardless of what the shell shows.
 */
export interface NavItem {
  href: string;
  label: string;
  /** Permission string from `MeResponse.permissions` required to show this
   *  item. Omit for an item every active company member may see. */
  permission?: string;
  /** Restrict this item to one company type (e.g. Carrier Groups is a
   *  shipper-only concept). Omit for an item relevant to both. */
  companyType?: CompanyType;
}

export const SHIPPER_PRIMARY_NAV: readonly NavItem[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/loads", label: "Loads", permission: "load:read:own" },
  { href: "/shipments", label: "Shipments", permission: "load:read:own" },
  { href: "/network", label: "Carrier Network", permission: "network:request" },
];

export const CARRIER_PRIMARY_NAV: readonly NavItem[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/marketplace", label: "Find Freight", permission: "marketplace:browse" },
  { href: "/network", label: "Connections", permission: "network:request" },
  { href: "/marketplace/offers", label: "My Offers", permission: "offer:create" },
  { href: "/my-shipments", label: "My Shipments", permission: "marketplace:browse" },
];

/** Administrative/configuration capabilities — daily freight workflow lives
 *  in the primary lists above, not here. */
export const SECONDARY_NAV: readonly NavItem[] = [
  { href: "/network/groups", label: "Carrier Groups", permission: "network:manage", companyType: "SHIPPER" },
  { href: "/locations", label: "Locations", permission: "location:read" },
  { href: "/equipment", label: "Equipment", permission: "equipment:read" },
  { href: "/settings/carrier-profile", label: "Carrier Profile", permission: "carrier:profile:manage" },
  { href: "/settings/company", label: "Company" },
  { href: "/settings/members", label: "Team" },
];

export function primaryNavFor(companyType: CompanyType | null): readonly NavItem[] {
  return companyType === "CARRIER" ? CARRIER_PRIMARY_NAV : SHIPPER_PRIMARY_NAV;
}

export function visibleNavItems(
  items: readonly NavItem[],
  permissions: readonly string[],
  companyType: CompanyType | null,
): NavItem[] {
  return items.filter(
    (item) =>
      (!item.permission || permissions.includes(item.permission)) &&
      (!item.companyType || item.companyType === companyType),
  );
}
