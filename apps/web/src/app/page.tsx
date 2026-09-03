import type { HealthReport } from "@loadtopia/shared";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

async function fetchHealth(): Promise<HealthReport | { status: "error"; message: string }> {
  try {
    const res = await fetch(`${API_BASE}/api/health`, { cache: "no-store" });
    return (await res.json()) as HealthReport;
  } catch (err) {
    return { status: "error", message: (err as Error).message };
  }
}

export default async function HomePage() {
  const health = await fetchHealth();

  return (
    <main>
      <span className="pill">Phase 0 — Foundation</span>
      <h1>LoadTopia</h1>
      <p style={{ color: "var(--muted)" }}>
        Direct freight marketplace connecting shippers with qualified carriers. This is the
        engineering foundation only — the marketplace, load creation, pricing, and matching are
        not built yet.
      </p>

      <div className="card">
        <strong>API health</strong>
        <p style={{ color: "var(--muted)", margin: "0.25rem 0 0.75rem" }}>
          Live check against <code>{API_BASE}/api/health</code>
        </p>
        <pre>
          <code>{JSON.stringify(health, null, 2)}</code>
        </pre>
      </div>

      <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginTop: "2rem" }}>
        All external-provider data in this environment is mock data and must not be treated as real.
      </p>
    </main>
  );
}
