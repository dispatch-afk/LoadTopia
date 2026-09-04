"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { OfferThreadView } from "@loadtopia/shared";
import { ApiError, apiClient } from "@/lib/api-client";
import { fmtDateTime, titleCase } from "@/lib/format";
import { Alert, Badge, Button, Field, Input, Spinner, Textarea } from "./ui";

const STATUS_TONE: Record<string, "gray" | "green" | "amber" | "red" | "indigo"> = {
  ACTIVE: "amber",
  ACCEPTED: "green",
  REJECTED: "red",
  WITHDRAWN: "gray",
  EXPIRED: "gray",
};

function money(v: string | null, currency = "USD") {
  if (v == null) return "—";
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(Number(v));
}

/**
 * One negotiation thread with its full immutable round history and the actions
 * the current viewer may take. Server decides every action's validity — the
 * buttons here are cosmetic gating driven by `thread.actions`.
 */
export function OfferThread({ thread }: { thread: OfferThreadView }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<"counter" | null>(null);
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState("");

  const roundId = thread.rounds.at(-1)?.id;

  async function act(kind: string, fn: () => Promise<unknown>) {
    setBusy(kind);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Action failed");
    } finally {
      setBusy(null);
    }
  }

  const counter = () =>
    act("counter", () =>
      apiClient(`/offers/rounds/${roundId}/counter`, {
        method: "POST",
        body: JSON.stringify({ amount, currency: thread.currentCurrency, message: message || undefined }),
      }).then(() => {
        setForm(null);
        setAmount("");
        setMessage("");
      }),
    );

  const accept = () =>
    act("accept", () => apiClient(`/offers/rounds/${roundId}/accept`, { method: "POST" }));

  const reject = () =>
    act("reject", () => apiClient(`/offers/threads/${thread.threadId}/reject`, { method: "POST" }));

  const withdraw = () =>
    act("withdraw", () => apiClient(`/offers/threads/${thread.threadId}/withdraw`, { method: "POST" }));

  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {thread.carrier && <span className="text-sm font-medium text-ink">{thread.carrier.name}</span>}
          <Badge tone={STATUS_TONE[thread.status] ?? "gray"}>{titleCase(thread.status)}</Badge>
          {thread.awaitingMyResponse && thread.status === "ACTIVE" && (
            <Badge tone="indigo">Your move</Badge>
          )}
        </div>
        <span className="text-sm font-semibold text-ink">
          {money(thread.currentAmount, thread.currentCurrency)}
        </span>
      </div>

      <ol className="mb-3 space-y-2 border-l border-line pl-3">
        {thread.rounds.map((r) => (
          <li key={r.id} className="text-sm">
            <span className="font-medium text-ink">
              {r.proposedByParty === "CARRIER" ? "Carrier" : "Shipper"} · {money(r.amount, r.currency)}
            </span>
            {r.isExpired && <span className="text-red-600"> · expired</span>}
            <span className="block text-xs text-muted">
              Round {r.roundNumber} · {fmtDateTime(r.createdAt)} · expires {fmtDateTime(r.expiresAt)}
            </span>
            {r.message && <p className="text-muted">“{r.message}”</p>}
          </li>
        ))}
      </ol>

      {thread.events.length > 0 && (
        <details className="mb-3 text-xs text-muted">
          <summary className="cursor-pointer">Event history</summary>
          <ul className="mt-1 space-y-0.5">
            {thread.events.map((e) => (
              <li key={e.id}>
                {titleCase(e.type)} · {e.actorParty === "SYSTEM" ? "system" : e.actorName ?? e.actorParty} ·{" "}
                {fmtDateTime(e.createdAt)}
              </li>
            ))}
          </ul>
        </details>
      )}

      {error && <Alert>{error}</Alert>}

      {form === "counter" ? (
        <div className="space-y-2">
          <Field label={`Counter amount (${thread.currentCurrency})`} required>
            <Input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="1750.00"
            />
          </Field>
          <Field label="Message (optional)">
            <Textarea value={message} onChange={(e) => setMessage(e.target.value)} maxLength={1000} />
          </Field>
          <div className="flex gap-2">
            <Button onClick={counter} disabled={busy !== null || !amount}>
              {busy === "counter" && <Spinner />} Send counter
            </Button>
            <Button variant="ghost" onClick={() => setForm(null)} disabled={busy !== null}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {thread.actions.canAccept && (
            <Button onClick={accept} disabled={busy !== null}>
              {busy === "accept" && <Spinner />} Accept {money(thread.currentAmount, thread.currentCurrency)}
            </Button>
          )}
          {thread.actions.canCounter && (
            <Button variant="secondary" onClick={() => setForm("counter")} disabled={busy !== null}>
              Counter
            </Button>
          )}
          {thread.actions.canReject && (
            <Button variant="danger" onClick={reject} disabled={busy !== null}>
              {busy === "reject" && <Spinner />} Reject
            </Button>
          )}
          {thread.actions.canWithdraw && (
            <Button variant="danger" onClick={withdraw} disabled={busy !== null}>
              {busy === "withdraw" && <Spinner />} Withdraw
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
