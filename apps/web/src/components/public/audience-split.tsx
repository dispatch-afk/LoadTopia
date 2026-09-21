/**
 * Shipper / Carrier split (Milestone 4 public site). Outcome-framed copy
 * only — no internal enum/state names, no ranking/matching-algorithm
 * language beyond factual lane/equipment/timing filters, no cost-savings or
 * earnings claims.
 */
export function AudienceSplit() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-16">
      <div className="grid gap-8 md:grid-cols-2">
        <div id="shippers" className="scroll-mt-20 rounded-xl border border-line bg-white p-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">For Shippers</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-ink">
            Control who moves your freight.
          </h2>
          <p className="mt-3 text-muted">
            Control who sees your freight. Work directly with the carriers you choose. Publish a rate
            or open it to offers. Move it into operations the moment it&apos;s covered.
          </p>
          <ul className="mt-5 space-y-2 text-sm text-ink">
            <li>Post a load and choose your audience</li>
            <li>Build a private Carrier Network</li>
            <li>Publish a rate, or request private offers</li>
            <li>Award and hand off to shipment execution</li>
          </ul>
        </div>

        <div id="carriers" className="scroll-mt-20 rounded-xl border border-line bg-white p-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">For Carriers</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-ink">
            Find freight, work directly.
          </h2>
          <p className="mt-3 text-muted">
            Find freight by lane, equipment, and pickup timing. Negotiate directly with the shipper.
            Book at a posted rate or submit an offer. Manage the shipments you win and build direct
            working relationships.
          </p>
          <ul className="mt-5 space-y-2 text-sm text-ink">
            <li>Find freight that matches your lane and equipment</li>
            <li>Negotiate privately with the shipper</li>
            <li>Book at a posted rate, or make your case</li>
            <li>Manage every shipment you win</li>
          </ul>
        </div>
      </div>
    </section>
  );
}
