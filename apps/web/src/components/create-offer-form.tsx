"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, apiClient, fieldErrors } from "@/lib/api-client";
import { Alert, Button, Field, Input, Spinner, Textarea } from "./ui";

export function CreateOfferForm({ loadId }: { loadId: string }) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState("");
  const [expiresInHours, setExpiresInHours] = useState("72");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fErrors, setFErrors] = useState<Record<string, string>>({});

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFErrors({});
    try {
      await apiClient(`/marketplace/loads/${loadId}/offers`, {
        method: "POST",
        body: JSON.stringify({
          amount,
          currency: "USD",
          message: message || undefined,
          expiresInHours: Number(expiresInHours),
        }),
      });
      router.refresh();
    } catch (err) {
      setFErrors(fieldErrors(err));
      setError(err instanceof ApiError ? err.message : "Could not submit offer");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {error && <Alert>{error}</Alert>}
      <Field label="Your rate (USD)" required error={fErrors.amount}>
        <Input
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="1850.00"
        />
      </Field>
      <Field label="Offer valid for (hours)" error={fErrors.expiresInHours}>
        <Input
          type="number"
          min={1}
          max={336}
          value={expiresInHours}
          onChange={(e) => setExpiresInHours(e.target.value)}
        />
      </Field>
      <Field label="Message to shipper (optional)" error={fErrors.message}>
        <Textarea value={message} onChange={(e) => setMessage(e.target.value)} maxLength={1000} />
      </Field>
      <Button type="submit" disabled={busy || !amount}>
        {busy && <Spinner />} Submit offer
      </Button>
    </form>
  );
}
