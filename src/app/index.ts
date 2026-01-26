import { createServer } from "@app/server";

async function main() {
  const { app, PORT } = await createServer();
  app.listen(PORT);
}

main().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
