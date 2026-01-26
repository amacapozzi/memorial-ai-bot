import { Elysia } from "elysia";

import { buildApp } from "@app/container";
import { env } from "@shared/env/env";

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;

  if (typeof err === "object" && err !== null && "message" in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }

  try {
    return JSON.stringify(err);
  } catch {
    return "Unknown error";
  }
}

export async function createServer() {
  const { PORT } = env();
  const { logger, modules, startServices, stopServices } = buildApp();

  const app = new Elysia()
    .onError(({ code, error, set }) => {
      set.status = code === "NOT_FOUND" ? 404 : 500;
      return { ok: false, code, message: getErrorMessage(error) };
    })
    .get("/health", () => ({ ok: true, status: "running" }));

  // Register all modules
  for (const mod of modules) app.use(mod);

  // Handle graceful shutdown
  const shutdown = async () => {
    logger.info("Shutting down...");
    await stopServices();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Start background services (WhatsApp, Scheduler)
  await startServices();

  logger.info(`Server ready on http://localhost:${PORT}`);

  return { app, PORT };
}
