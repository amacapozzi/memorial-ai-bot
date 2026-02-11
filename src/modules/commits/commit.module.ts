import { Elysia } from "elysia";

import { createLogger } from "@shared/logger/logger";

import type { CommitService } from "./commit.service";

const logger = createLogger("commit-module");

async function verifySignature(secret: string, body: string, signature: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const expected = `sha256=${Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")}`;
  return signature === expected;
}

export function createCommitModule(commitService: CommitService, webhookSecret?: string) {
  return new Elysia({ prefix: "/webhook" }).post("/github", async ({ request }) => {
    if (!webhookSecret) {
      logger.warn("GITHUB_WEBHOOK_SECRET not configured, rejecting request");
      return new Response(JSON.stringify({ ok: false, error: "Webhook not configured" }), {
        status: 503,
        headers: { "Content-Type": "application/json" }
      });
    }

    const rawBody = await request.clone().text();
    const signature = request.headers.get("x-hub-signature-256") ?? "";

    if (!signature || !(await verifySignature(webhookSecret, rawBody, signature))) {
      return new Response(JSON.stringify({ ok: false, error: "Invalid signature" }), {
        status: 401,
        headers: { "Content-Type": "application/json" }
      });
    }

    const event = request.headers.get("x-github-event");
    if (event !== "push") {
      return { ok: true, skipped: true, reason: `Ignored event: ${event}` };
    }

    const payload = JSON.parse(rawBody);
    const saved = await commitService.processGitHubPush(payload);
    return { ok: true, saved };
  });
}
