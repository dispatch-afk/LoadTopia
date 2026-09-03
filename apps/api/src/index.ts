import { buildApp } from "./app";
import { loadEnv } from "./config/env";

async function main() {
  const env = loadEnv();
  const app = await buildApp({ env });

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "shutting down");
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  try {
    await app.listen({ host: env.API_HOST, port: env.API_PORT });
  } catch (err) {
    app.log.error(err, "failed to start");
    process.exit(1);
  }
}

void main();
