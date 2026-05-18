import { createServer } from "@app/server";

async function main() {
  const { app, PORT } = await createServer();

  app.listen({
    port: PORT,
    hostname: "0.0.0.0"
  });
}

main().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
