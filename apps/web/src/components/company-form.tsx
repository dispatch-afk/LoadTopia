"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { CompanyView } from "@loadtopia/shared";
import { ApiError, apiClient, fieldErrors } from "@/lib/api-client";
import { Alert, Button, Card, Field, Input, Spinner } from "./ui";

export function CompanyForm({ company, canEdit }: { company: CompanyView; canEdit: boolean }) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: company.name,
    mcNumber: company.mcNumber ?? "",
    dotNumber: company.dotNumber ?? "",
    phone: company.phone ?? "",
    email: company.email ?? "",
    addressLine1: company.addressLine1 ?? "",
    addressLine2: company.addressLine2 ?? "",
    city: company.city ?? "",
    state: company.state ?? "",
    postalCode: company.postalCode ?? "",
  });
  const [fErr, setFErr] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setOk(false);
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFErr({});
    setOk(false);
    const payload = Object.fromEntries(
      Object.entries(form).map(([k, v]) => [k, v.trim() === "" ? undefined : v.trim()]),
    );
    try {
      await apiClient(`/companies/${company.id}`, { method: "PATCH", body: JSON.stringify(payload) });
      setOk(true);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError && err.code === "VALIDATION_ERROR") {
        setFErr(fieldErrors(err));
        setError(err.message);
      } else {
        setError(err instanceof ApiError ? err.message : "Could not save");
      }
    } finally {
      setBusy(false);
    }
  }

  const field = (name: keyof typeof form, label: string, props = {}) => (
    <Field label={label} error={fErr[name]}>
      <Input
        value={form[name]}
        disabled={!canEdit}
        onChange={(e) => set(name, e.target.value)}
        {...props}
      />
    </Field>
  );

  return (
    <Card className="p-5">
      <form onSubmit={save} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        {ok && <Alert tone="info">Saved.</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          {field("name", "Company name")}
          <Field label="Load number prefix">
            <Input value={company.loadNumberPrefix} disabled />
          </Field>
          {field("mcNumber", "MC number")}
          {field("dotNumber", "DOT number")}
          {field("phone", "Phone")}
          {field("email", "Email", { type: "email" })}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {field("addressLine1", "Address line 1")}
          {field("addressLine2", "Address line 2")}
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="col-span-2">{field("city", "City")}</div>
          {field("state", "State", { maxLength: 2 })}
          {field("postalCode", "ZIP")}
        </div>
        {canEdit && (
          <Button type="submit" disabled={busy}>
            {busy && <Spinner />} Save company
          </Button>
        )}
      </form>
    </Card>
  );
}
