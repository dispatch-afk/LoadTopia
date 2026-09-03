"use client";

export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
      <h1 className="text-lg font-semibold text-red-700">Something went wrong</h1>
      <p className="mt-1 text-sm text-red-600">
        The page failed to load. This has been logged.
      </p>
      <button
        onClick={reset}
        className="mt-4 rounded-lg bg-white px-3.5 py-2 text-sm font-medium text-red-700 ring-1 ring-red-200 hover:bg-red-100"
      >
        Try again
      </button>
    </div>
  );
}
