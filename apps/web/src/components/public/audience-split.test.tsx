// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AudienceSplit } from "./audience-split";

describe("AudienceSplit", () => {
  it("exposes anchor-addressable Shipper and Carrier sections", () => {
    render(<AudienceSplit />);
    expect(document.getElementById("shippers")).toBeInTheDocument();
    expect(document.getElementById("carriers")).toBeInTheDocument();
  });

  it("describes only implemented, factual carrier discovery — never AI/ranking", () => {
    render(<AudienceSplit />);
    const body = document.body.textContent?.toLowerCase() ?? "";
    expect(body).toContain("lane");
    expect(body).toContain("equipment");
    for (const banned of ["ai-powered", "smart match", "best match", "recommended", "ranking"]) {
      expect(body).not.toContain(banned);
    }
    expect(body).not.toMatch(/\bai\b/i);
  });

  it("never claims cost savings or earnings", () => {
    render(<AudienceSplit />);
    const body = document.body.textContent?.toLowerCase() ?? "";
    for (const banned of ["save money", "earnings", "roi", "% more", "profit"]) {
      expect(body).not.toContain(banned);
    }
  });
});
