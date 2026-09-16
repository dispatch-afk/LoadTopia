// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AttentionCenter, type AttentionCenterEntry } from "./attention-center";
import {
  CARRIER_ATTENTION_HREF,
  CARRIER_ATTENTION_LABEL,
  SHIPPER_ATTENTION_HREF,
  SHIPPER_ATTENTION_LABEL,
} from "@/lib/dashboard-attention";

const BANNED_WORDS = [
  "Hot",
  "Trending",
  "High Demand",
  "Great Rate",
  "Best Match",
  "Top Carrier",
  "Urgent",
  "Priority",
  "Recommended",
  "Excellent",
  "Great Lane",
  "Going fast",
  "Only 2",
];

describe("AttentionCenter", () => {
  it("renders only non-zero items with their label and count", () => {
    const items: AttentionCenterEntry[] = [
      { key: "a", label: "Needs Coverage", count: 3, href: "/loads" },
      { key: "b", label: "POD Awaiting Review", count: 0, href: "/shipments" },
      { key: "c", label: "Ready to Complete", count: 1, href: "/shipments" },
    ];
    render(<AttentionCenter items={items} />);
    expect(screen.getByText("Needs Coverage")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("Ready to Complete")).toBeInTheDocument();
    expect(screen.queryByText("POD Awaiting Review")).not.toBeInTheDocument();
  });

  it("shows a calm, factual message when every item is zero — never implies zero active freight", () => {
    const items: AttentionCenterEntry[] = [
      { key: "a", label: "Needs Coverage", count: 0, href: "/loads" },
      { key: "b", label: "POD Awaiting Review", count: 0, href: "/shipments" },
    ];
    render(<AttentionCenter items={items} />);
    expect(screen.getByText("Nothing needs your attention right now.")).toBeInTheDocument();
    const body = document.body.textContent ?? "";
    expect(body).not.toMatch(/no (active )?freight/i);
    expect(body).not.toMatch(/no shipments/i);
  });

  it("links each item to its href", () => {
    const items: AttentionCenterEntry[] = [
      { key: "a", label: "Needs Coverage", count: 2, href: "/loads" },
    ];
    render(<AttentionCenter items={items} />);
    expect(screen.getByRole("link", { name: /Needs Coverage/ })).toHaveAttribute("href", "/loads");
  });

  it("renders an empty items array as the calm zero state, not a blank section", () => {
    render(<AttentionCenter items={[]} />);
    expect(screen.getByText("Nothing needs your attention right now.")).toBeInTheDocument();
  });
});

describe("dashboard attention vocabulary (Phase 8 phantom-signal regression)", () => {
  it("no shipper attention label uses manufactured urgency/scarcity/performance language", () => {
    for (const label of Object.values(SHIPPER_ATTENTION_LABEL)) {
      for (const banned of BANNED_WORDS) {
        expect(label.toLowerCase()).not.toContain(banned.toLowerCase());
      }
    }
  });

  it("no carrier attention label uses manufactured urgency/scarcity/performance language", () => {
    for (const label of Object.values(CARRIER_ATTENTION_LABEL)) {
      for (const banned of BANNED_WORDS) {
        expect(label.toLowerCase()).not.toContain(banned.toLowerCase());
      }
    }
  });

  it("Replacement POD Needed is phrased as shipper awareness, never as the shipper's own action", () => {
    const label = SHIPPER_ATTENTION_LABEL.REPLACEMENT_POD_NEEDED;
    expect(label).toBe("Replacement POD Needed");
    expect(label.toLowerCase()).not.toMatch(/you (must|need to)|upload|replace it/);
  });

  it("every attention kind has both a label and a destination", () => {
    for (const kind of Object.keys(SHIPPER_ATTENTION_LABEL)) {
      expect(SHIPPER_ATTENTION_HREF[kind as keyof typeof SHIPPER_ATTENTION_HREF]).toBeTruthy();
    }
    for (const kind of Object.keys(CARRIER_ATTENTION_LABEL)) {
      expect(CARRIER_ATTENTION_HREF[kind as keyof typeof CARRIER_ATTENTION_HREF]).toBeTruthy();
    }
  });
});
