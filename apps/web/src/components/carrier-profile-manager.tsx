"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { EQUIPMENT_TYPES, type CarrierProfileView } from "@loadtopia/shared";
import { ApiError, apiClient, fieldErrors } from "@/lib/api-client";
import { fmtDateTime, titleCase } from "@/lib/format";
import { Alert, Badge, Button, Card, Field, Input, Spinner } from "./ui";

const ELIGIBILITY_TONE: Record<string, "gray" | "green" | "amber" | "red" | "indigo"> = {
  PENDING: "amber",
  ELIGIBLE: "green",
  INELIGIBLE: "red",
  SUSPENDED: "red",
};

export function CarrierProfileManager({ profile }: { profile: CarrierProfileView | null }) {
  const router = useRouter();
  const [legalName, setLegalName] = useState(profile?.legalName ?? "");
  const [mcNumber, setMcNumber] = useState(profile?.mcNumber ?? "");
  const [dotNumber, setDotNumber] = useState(profile?.dotNumber ?? "");
  const [equipment, setEquipment] = useState<string[]>(profile?.equipmentTypes ?? []);
  const [states, setStates] = useState((profile?.serviceAreaStates ?? []).join(", "));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fErrors, setFErrors] = useState<Record<string, string>>({});

  function toggle(t: string) {
    setEquipment((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy("save");
    setError(null);
    setFErrors({});
    try {
      await apiClient("/carrier/profile", {
        method: "PUT",
        body: JSON.stringify({
          legalName,
          mcNumber: mcNumber || undefined,
          dotNumber: dotNumber || undefined,
          equipmentTypes: equipment,
          serviceAreaStates: states
            .split(",")
            .map((s) => s.trim().toUpperCase())
            .filter(Boolean),
        }),
      });
      router.refresh();
    } catch (err) {
      setFErrors(fieldErrors(err));
      setError(err instanceof ApiError ? err.message : "Could not save profile");
    } finally {
      setBusy(null);
    }
  }

  async function verify() {
    setBusy("verify");
    setError(null);
    try {
      await apiClient("/carrier/profile/verify", { method: "POST" });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Verification failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      {profile && (
        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-ink">Marketplace status</p>
              <p className="mt-1 flex items-center gap-2 text-sm">
                <Badge tone={ELIGIBILITY_TONE[profile.marketplaceEligibility] ?? "gray"}>
                  {titleCase(profile.marketplaceEligibility)}
                </Badge>
                <span className="text-muted">
                  Verification: {titleCase(profile.verification.status)}
                  {profile.verification.isMock && " (mock)"}
                </span>
              </p>
              {profile.eligibilityReason && (
                <p className="mt-1 text-xs text-muted">{profile.eligibilityReason}</p>
              )}
              {profile.verification.verifiedAt && (
                <p className="mt-1 text-xs text-muted">
                  Last verified {fmtDateTime(profile.verification.verifiedAt)}
                </p>
              )}
            </div>
            <Button onClick={verify} disabled={busy !== null} variant="secondary">
              {busy === "verify" && <Spinner />} Run verification
            </Button>
          </div>
          {profile.verification.note && (
            <p className="mt-3 border-t border-line pt-3 text-xs text-muted">
              {profile.verification.note}
            </p>
          )}
        </Card>
      )}

      <Card className="p-5">
        <h2 className="mb-4 text-sm font-semibold text-ink">
          {profile ? "Edit profile" : "Create your carrier profile"}
        </h2>
        <p className="mb-4 text-xs text-muted">
          Editing identity or capabilities resets your marketplace eligibility to Pending — you will
          need to run verification again.
        </p>
        <form onSubmit={save} className="space-y-4">
          {error && <Alert>{error}</Alert>}
          <Field label="Legal name" required error={fErrors.legalName}>
            <Input value={legalName} onChange={(e) => setLegalName(e.target.value)} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="MC number" error={fErrors.mcNumber}>
              <Input value={mcNumber} onChange={(e) => setMcNumber(e.target.value)} />
            </Field>
            <Field label="DOT number" error={fErrors.dotNumber}>
              <Input value={dotNumber} onChange={(e) => setDotNumber(e.target.value)} />
            </Field>
          </div>
          <div>
            <span className="mb-1 block text-sm font-medium text-ink">Equipment</span>
            <div className="flex flex-wrap gap-2">
              {EQUIPMENT_TYPES.map((t) => (
                <button
                  type="button"
                  key={t}
                  onClick={() => toggle(t)}
                  className={
                    "rounded-full border px-3 py-1 text-sm transition " +
                    (equipment.includes(t)
                      ? "border-brand-600 bg-brand-600 text-white"
                      : "border-line bg-white text-slate-600 hover:bg-brand-50")
                  }
                >
                  {titleCase(t)}
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-muted">
              Leave all unselected to receive loads for any equipment type.
            </p>
          </div>
          <Field
            label="Service area (state codes, comma-separated)"
            hint="e.g. IL, WI, IN. Leave blank to serve all origins."
            error={fErrors.serviceAreaStates}
          >
            <Input value={states} onChange={(e) => setStates(e.target.value)} placeholder="IL, WI, IN" />
          </Field>
          <Button type="submit" disabled={busy !== null || !legalName}>
            {busy === "save" && <Spinner />} Save profile
          </Button>
        </form>
      </Card>
    </div>
  );
}
