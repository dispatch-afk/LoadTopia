/**
 * Shipment Execution (Milestone 4 public site). Deliberately says "manual
 * check-ins" rather than "tracking" — no GPS/ELD/telematics/automated
 * tracking exists in the product. Rate Confirmation is mentioned only as
 * "a documented rate agreement," never by its internal name or storage
 * detail.
 */
export function ShipmentSection() {
  return (
    <section className="border-y border-line bg-canvas">
      <div className="mx-auto max-w-6xl px-5 py-16">
        <h2 className="text-2xl font-semibold tracking-tight text-ink">From covered to complete</h2>
        <p className="mt-3 max-w-2xl text-muted">
          Once a load is covered, it becomes a shipment — with its own factual status, a clear next
          action, and a documented rate agreement between both sides.
        </p>
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <h3 className="text-sm font-semibold text-ink">Factual status</h3>
            <p className="mt-1 text-sm text-muted">Always know exactly where the shipment stands.</p>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-ink">Guided next action</h3>
            <p className="mt-1 text-sm text-muted">Know what you — specifically — need to do next.</p>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-ink">Manual check-ins</h3>
            <p className="mt-1 text-sm text-muted">Record pickup, in-transit, and delivery updates.</p>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-ink">Documents &amp; proof of delivery</h3>
            <p className="mt-1 text-sm text-muted">Upload, review, and complete with POD.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
