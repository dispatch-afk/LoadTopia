import { z } from "zod";

/**
 * Single, validated source of runtime configuration. Import `env` — never read
 * `process.env` elsewhere. Invalid/missing config fails the process at boot
 * rather than at first use.
 */
const booleanish = z
  .union([z.boolean(), z.enum(["true", "false", "1", "0"])])
  .transform((v) => v === true || v === "true" || v === "1");

const providerChoice = z.string().min(1).default("mock");

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  API_HOST: z.string().default("0.0.0.0"),
  API_PORT: z.coerce.number().int().positive().max(65535).default(4000),
  CORS_ORIGINS: z.string().default("http://localhost:3000"),

  DATABASE_URL: z.string().url(),

  SESSION_COOKIE_NAME: z.string().min(1).default("loadtopia_session"),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().max(24 * 90).default(168),
  SESSION_COOKIE_SECURE: booleanish.default(false),
  COOKIE_DOMAIN: z.string().optional(),

  ARGON_MEMORY_KIB: z.coerce.number().int().min(8192).default(19456),
  ARGON_TIME_COST: z.coerce.number().int().min(2).default(2),
  ARGON_PARALLELISM: z.coerce.number().int().min(1).default(1),

  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  RATE_LIMIT_WINDOW: z.string().default("1 minute"),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  AUTH_RATE_LIMIT_WINDOW: z.string().default("1 minute"),

  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),

  ROUTING_PROVIDER: providerChoice,
  PRICING_PROVIDER: providerChoice,
  GEOCODING_PROVIDER: providerChoice,
  PAYMENT_PROVIDER: providerChoice,
  STORAGE_PROVIDER: providerChoice,
  NOTIFICATION_PROVIDER: providerChoice,
  TRACKING_PROVIDER: providerChoice,
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const env = parsed.data;

  if (env.NODE_ENV === "production" && !env.SESSION_COOKIE_SECURE) {
    throw new Error("SESSION_COOKIE_SECURE must be true in production.");
  }
  return env;
}

export function corsOrigins(env: Env): string[] {
  return env.CORS_ORIGINS.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function providerSelection(env: Env) {
  return {
    routing: env.ROUTING_PROVIDER,
    pricing: env.PRICING_PROVIDER,
    geocoding: env.GEOCODING_PROVIDER,
    payment: env.PAYMENT_PROVIDER,
    storage: env.STORAGE_PROVIDER,
    notification: env.NOTIFICATION_PROVIDER,
    tracking: env.TRACKING_PROVIDER,
  };
}
