import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { CarrierGroupView, ConnectionView, LoadView, Paginated } from "@loadtopia/shared";
import { ApiError, apiServer } from "@/lib/api-server";
import { PageHeader } from "@/components/ui";
import { ReviewPostForm } from "@/components/loads/review-post-form";
import { requireMe } from "@/lib/session";

export default async function ReviewPostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireMe();

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

  const [connections, groups] = await Promise.all([
    apiServer<Paginated<ConnectionView>>("/api/connections", { query: { pageSize: 100 } }).catch(
      () => ({ data: [] as ConnectionView[] }) as Paginated<ConnectionView>,
    ),
    apiServer<CarrierGroupView[]>("/api/carrier-groups").catch(() => [] as CarrierGroupView[]),
  ]);
  const acceptedConnections = connections.data.filter((c) => c.status === "ACCEPTED");

  return (
    <div>
      <PageHeader
        title="Review & Post"
        subtitle={`${load.referenceNumber} · choose who sees this freight first`}
      />
      <Link href={`/loads/${id}`} className="mb-4 inline-block text-sm text-brand-600 hover:underline">
        ← Back to load
      </Link>

      <ReviewPostForm load={load} connections={acceptedConnections} groups={groups} />
    </div>
  );
}
