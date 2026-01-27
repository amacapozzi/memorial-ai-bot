import { Elysia } from "elysia";

import { createLogger } from "@shared/logger/logger";

import type { GmailAuthService } from "./gmail/gmail-auth.service";
import type { UserService } from "./user/user.service";

const logger = createLogger("email-module");

export function createEmailModule(authService: GmailAuthService, userService: UserService) {
  return new Elysia({ prefix: "/auth/gmail" })
    .get("/", async ({ query }) => {
      const userId = query.userId;

      if (!userId || typeof userId !== "string") {
        return { ok: false, error: "Missing userId parameter" };
      }

      // Verify user exists
      const user = await userService.getUserById(userId);
      if (!user) {
        return { ok: false, error: "User not found" };
      }

      const authUrl = authService.getAuthUrl(user.id);
      logger.info(`Redirecting to Gmail OAuth for user: ${user.id}`);

      return new Response(null, {
        status: 302,
        headers: { Location: authUrl }
      });
    })
    .get("/callback", async ({ query }) => {
      const code = query.code;
      const state = query.state; // userId passed in state parameter

      if (!code || typeof code !== "string") {
        return { ok: false, error: "Missing authorization code" };
      }

      if (!state || typeof state !== "string") {
        return { ok: false, error: "Missing state parameter (userId)" };
      }

      try {
        await authService.handleCallback(code, state);
        return {
          ok: true,
          message:
            "Gmail conectado exitosamente! Ya puedes cerrar esta ventana. Te avisare cuando lleguen emails importantes."
        };
      } catch (error) {
        logger.error("Gmail OAuth callback failed", error);
        return { ok: false, error: "Failed to authenticate with Gmail" };
      }
    })
    .get("/status", async ({ query }) => {
      const chatId = query.chatId;

      if (!chatId || typeof chatId !== "string") {
        return { ok: false, error: "Missing chatId parameter" };
      }

      const user = await userService.getUserByChatId(chatId);

      if (!user) {
        return {
          ok: true,
          authenticated: false,
          message: "Gmail no esta conectado"
        };
      }

      const isAuthenticated = await authService.isAuthenticated(user.id);

      return {
        ok: true,
        authenticated: isAuthenticated,
        message: isAuthenticated ? "Gmail esta conectado" : "Gmail no esta conectado"
      };
    })
    .delete("/", async ({ query }) => {
      const chatId = query.chatId;

      if (!chatId || typeof chatId !== "string") {
        return { ok: false, error: "Missing chatId parameter" };
      }

      const user = await userService.getUserByChatId(chatId);

      if (!user) {
        return { ok: false, error: "User not found" };
      }

      await authService.revokeAccess(user.id);

      return {
        ok: true,
        message: "Gmail desconectado exitosamente"
      };
    });
}
