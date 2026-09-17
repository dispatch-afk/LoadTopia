const SHIPPER_STEPS = [
  "Post your load",
  "Choose your audience",
  "Review offers or get booked at your posted rate",
  "Award",
  "Manage the shipment",
  "Complete with proof of delivery",
];

const CARRIER_STEPS = ["Find freight", "Connect and negotiate", "Book or win the load", "Move it", "Deliver and complete"];

function StepList({ title, steps }: { title: string; steps: string[] }) {
  return (
    <div>
      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">{title}</h3>
      <ol className="mt-4 space-y-3">
        {steps.map((step, i) => (
          <li key={step} className="flex items-start gap-3 text-sm text-ink">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700">
              {i + 1}
            </span>
            <span className="mt-0.5">{step}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Customer-facing workflow only — no internal status/enum names. */
export function HowItWorks() {
  return (
    <section className="border-y border-line bg-canvas">
      <div className="mx-auto max-w-6xl px-5 py-16">
        <h2 className="text-2xl font-semibold tracking-tight text-ink">How it works</h2>
        <div className="mt-8 grid gap-10 md:grid-cols-2">
          <StepList title="Shipper" steps={SHIPPER_STEPS} />
          <StepList title="Carrier" steps={CARRIER_STEPS} />
        </div>
      </div>
    </section>
  );
}
