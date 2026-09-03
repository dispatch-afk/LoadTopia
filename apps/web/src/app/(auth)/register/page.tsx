"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CompanyType } from "@loadtopia/shared";
import { ApiError, apiClient, fieldErrors } from "@/lib/api-client";
import { Alert, Button, Card, Field, Input, Select, Spinner } from "@/components/ui";

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    password: "",
    companyName: "",
    companyType: CompanyType.SHIPPER as string,
  });
  const [error, setError] = useState<string | null>(null);
  const [fErr, setFErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFErr({});
    setBusy(true);
    try {
      await apiClient("/auth/register", { method: "POST", body: JSON.stringify(form) });
      router.replace("/dashboard");
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError && err.code === "VALIDATION_ERROR") {
        setFErr(fieldErrors(err));
        setError("Please fix the errors below.");
      } else {
        setError(err instanceof ApiError ? err.message : "Something went wrong");
      }
      setBusy(false);
    }
  }

  return (
    <Card className="p-6">
      <h1 className="text-lg font-semibold">Create your account</h1>
      <p className="mt-1 text-sm text-muted">Sets up your company and your login.</p>
      <form onSubmit={onSubmit} className="mt-5 space-y-4">
        {error && <Alert>{error}</Alert>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name" error={fErr.firstName}>
            <Input required value={form.firstName} onChange={(e) => set("firstName", e.target.value)} />
          </Field>
          <Field label="Last name" error={fErr.lastName}>
            <Input required value={form.lastName} onChange={(e) => set("lastName", e.target.value)} />
          </Field>
        </div>
        <Field label="Work email" error={fErr.email}>
          <Input
            type="email"
            required
            value={form.email}
            onChange={(e) => set("email", e.target.value)}
          />
        </Field>
        <Field label="Password" error={fErr.password} hint="At least 12 characters.">
          <Input
            type="password"
            required
            value={form.password}
            onChange={(e) => set("password", e.target.value)}
          />
        </Field>
        <Field label="Company name" error={fErr.companyName}>
          <Input
            required
            value={form.companyName}
            onChange={(e) => set("companyName", e.target.value)}
          />
        </Field>
        <Field label="Company type">
          <Select value={form.companyType} onChange={(e) => set("companyType", e.target.value)}>
            <option value={CompanyType.SHIPPER}>Shipper</option>
            <option value={CompanyType.CARRIER}>Carrier</option>
          </Select>
        </Field>
        <Button type="submit" disabled={busy} className="w-full">
          {busy && <Spinner />} Create account
        </Button>
      </form>
      <p className="mt-4 text-sm text-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-brand-600 hover:underline">
          Sign in
        </Link>
      </p>
    </Card>
  );
}
