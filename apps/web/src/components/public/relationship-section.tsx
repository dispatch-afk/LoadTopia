/**
 * Private Negotiation + Relationships + Audience Control (Milestone 4
 * public site) — combined into one section per the locked information
 * architecture. No thread/round/stage terminology, no guaranteed-capacity
 * or preferred-pricing claims, no exposure of private Carrier Group
 * membership.
 */
export function RelationshipSection() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-16">
      <div className="grid gap-10 md:grid-cols-3">
        <div>
          <h2 className="text-lg font-semibold text-ink">Private negotiation</h2>
          <p className="mt-2 text-sm text-muted">
            Your negotiation stays between you and the other party. Offers and counteroffers are
            private — not a public reverse auction, and never visible to anyone outside the
            conversation.
          </p>
        </div>
        <div>
          <h2 className="text-lg font-semibold text-ink">Direct relationships</h2>
          <p className="mt-2 text-sm text-muted">
            Find a carrier once. Build a direct relationship. Work together again — follow, connect,
            and organize the carriers you trust into your own private Carrier Network.
          </p>
        </div>
        <div>
          <h2 className="text-lg font-semibold text-ink">You choose the audience</h2>
          <p className="mt-2 text-sm text-muted">
            Choose who sees your freight, and when — the open board, your Carrier Network first, or
            specific carriers you select.
          </p>
        </div>
      </div>
    </section>
  );
}
