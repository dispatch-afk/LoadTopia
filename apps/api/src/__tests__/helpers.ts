import type { PrismaClient } from "@loadtopia/db";
import {
  createProviderRegistry,
  FakeStorageProvider,
  type ProviderRegistry,
  type StorageProvider,
} from "@loadtopia/providers";
import { type Env, loadEnv } from "../config/env";

export function testEnv(overrides: Partial<NodeJS.ProcessEnv> = {}): Env {
  return loadEnv({
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://test:test@localhost:5432/loadtopia_test?schema=public",
    LOG_LEVEL: "silent",
    ...overrides,
  } as NodeJS.ProcessEnv);
}

export const allMockProviders = () =>
  createProviderRegistry({
    routing: "mock",
    pricing: "mock",
    geocoding: "mock",
    carrierVerification: "mock",
    payment: "mock",
    storage: "mock",
    notification: "mock",
    tracking: "mock",
  });

/**
 * All-mock registry with a controllable in-process {@link FakeStorageProvider}
 * swapped in for storage — nothing here ever makes a network call. Used by the
 * Milestone 3 document / Rate Confirmation integration tests to exercise
 * real store/confirm/download behavior and simulate storage outages.
 */
export function providersWithFakeStorage(storage: StorageProvider = new FakeStorageProvider()): {
  providers: ProviderRegistry;
  storage: StorageProvider;
} {
  return { providers: { ...allMockProviders(), storage }, storage };
}

/** Minimal Prisma test double. Pass handlers for the calls a test exercises. */
export function fakePrisma(partial: Record<string, unknown> = {}): PrismaClient {
  return {
    $queryRawUnsafe: async () => [{ "?column?": 1 }],
    $disconnect: async () => {},
    ...partial,
  } as unknown as PrismaClient;
}
