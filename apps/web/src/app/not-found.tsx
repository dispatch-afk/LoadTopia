import Link from "next/link";

export default function NotFound() {
  return (
    <div className="grid min-h-screen place-items-center px-4 text-center">
      <div>
        <p className="text-sm font-semibold text-brand-600">404</p>
        <h1 className="mt-1 text-lg font-semibold">Not found</h1>
        <p className="mt-1 text-sm text-muted">
          This page doesn’t exist, or you don’t have access to it.
        </p>
        <Link
          href="/dashboard"
          className="mt-4 inline-block rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
