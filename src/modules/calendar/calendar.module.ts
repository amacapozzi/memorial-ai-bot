import { Elysia } from "elysia";

import { createLogger } from "@shared/logger/logger";

import type { GoogleAuthService } from "./google/google-auth.service";

const logger = createLogger("calendar-module");

export function createCalendarModule(authService: GoogleAuthService) {
  return new Elysia({ prefix: "/auth/google" })
    .get("/", () => {
      const authUrl = authService.getAuthUrl();
      logger.info("Redirecting to Google OAuth...");
      return new Response(null, {
        status: 302,
        headers: { Location: authUrl }
      });
    })
    .get("/callback", async ({ query }) => {
      const code = query.code;

      if (!code || typeof code !== "string") {
        return { ok: false, error: "Missing authorization code" };
      }

      try {
        await authService.handleCallback(code);
        return {
          ok: true,
          message:
            "Google Calendar conectado exitosamente! Ya puedes cerrar esta ventana y usar el bot."
        };
      } catch (error) {
        logger.error("OAuth callback failed", error);
        return { ok: false, error: "Failed to authenticate with Google" };
      }
    })
    .get("/status", async () => {
      const isAuthenticated = await authService.isAuthenticated();
      return {
        ok: true,
        authenticated: isAuthenticated,
        message: isAuthenticated
          ? "Google Calendar esta conectado"
          : "Google Calendar no esta conectado. Visita /auth/google para conectar."
      };
    });
}
