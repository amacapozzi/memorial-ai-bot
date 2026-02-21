import { Elysia } from "elysia";

import { createLogger } from "@shared/logger/logger";

import type { MeliAuthService } from "./auth/meli-auth.service";
import type { UserService } from "../email/user/user.service";

const logger = createLogger("mercadolibre-module");

export function createMercadoLibreModule(authService: MeliAuthService, userService: UserService) {
  return new Elysia({ prefix: "/auth/mercadolibre" })
    .get("/", async ({ query }) => {
      const userId = query.userId;

      if (!userId || typeof userId !== "string") {
        return { ok: false, error: "Missing userId parameter" };
      }

      const user = await userService.getUserById(userId);
      if (!user) {
        return { ok: false, error: "User not found" };
      }

      const authUrl = authService.getAuthUrl(user.id);
      logger.info(`Redirecting to MercadoLibre OAuth for user: ${user.id}`);

      return new Response(null, {
        status: 302,
        headers: { Location: authUrl }
      });
    })
    .get("/callback", async ({ query }) => {
      const code = query.code;
      const state = query.state;

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
            "MercadoLibre conectado exitosamente! Ya puedes cerrar esta ventana. Ahora puedo buscar productos y rastrear tus pedidos."
        };
      } catch (error) {
        logger.error("MercadoLibre OAuth callback failed", error);
        return { ok: false, error: "Failed to authenticate with MercadoLibre" };
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
          message: "MercadoLibre no esta conectado"
        };
      }

      const isAuthenticated = await authService.isAuthenticated(user.id);

      return {
        ok: true,
        authenticated: isAuthenticated,
        message: isAuthenticated ? "MercadoLibre esta conectado" : "MercadoLibre no esta conectado"
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
        message: "MercadoLibre desconectado exitosamente"
      };
    });
}
