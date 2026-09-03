import { notFound, redirect } from "next/navigation";
import type { LoadView, LocationView, Paginated } from "@loadtopia/shared";
import { ApiError, apiServer } from "@/lib/api-server";
import { Alert, PageHeader } from "@/components/ui";
import { LoadForm } from "@/components/load-form";

export default async function EditLoadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let load: LoadView;
  try {
    load = await apiServer<LoadView>(`/api/loads/${id}`);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 400)) notFound();
    throw err;
  }

  if (load.status !== "DRAFT") {
    redirect(`/loads/${id}`);
  }

  const locations = await apiServer<Paginated<LocationView>>("/api/locations", {
    query: { pageSize: 100 },
  });

  return (
    <div>
      <PageHeader title={`Edit ${load.referenceNumber}`} subtitle="Only draft loads can be edited." />
      <Alert tone="info">
        Changing origin, destination, or equipment re-runs the routing calculation.
      </Alert>
      <div className="mt-4">
        <LoadForm mode="edit" load={load} initialLocations={locations.data} />
      </div>
    </div>
  );
}
