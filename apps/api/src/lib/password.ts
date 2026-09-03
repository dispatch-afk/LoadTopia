import { hash, verify } from "@node-rs/argon2";

/**
 * Password hashing via Argon2id (@node-rs/argon2 — prebuilt native binaries,
 * incl. win32-arm64). Parameters come from validated env; defaults follow the
 * OWASP baseline (19 MiB, t=2, p=1).
 */
export interface Argon2Params {
  memoryKiB: number;
  timeCost: number;
  parallelism: number;
}

export async function hashPassword(plain: string, params: Argon2Params): Promise<string> {
  // @node-rs/argon2 defaults `algorithm` to Argon2id (2).
  return hash(plain, {
    memoryCost: params.memoryKiB,
    timeCost: params.timeCost,
    parallelism: params.parallelism,
  });
}

/** Constant-time verification; returns false on any malformed hash. */
export async function verifyPassword(storedHash: string, plain: string): Promise<boolean> {
  try {
    return await verify(storedHash, plain);
  } catch {
    return false;
  }
}
