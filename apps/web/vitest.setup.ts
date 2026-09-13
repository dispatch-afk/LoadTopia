import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// This project doesn't enable Vitest's `globals` option, so Testing
// Library's own auto-cleanup (which relies on a global `afterEach`) never
// registers — do it explicitly instead, or component trees from one test
// leak into the next.
afterEach(() => {
  cleanup();
});
