import { createServer } from "@app/server";

async function main() {
  const { app, PORT } = await createServer();

  // Listen on 0.0.0.0 to accept external connections (required for Railway/Docker)
  app.listen({
    port: PORT,
    hostname: "0.0.0.0"
  });
}

main().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
