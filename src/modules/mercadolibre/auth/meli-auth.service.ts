import { env } from "@shared/env/env";
import { createLogger } from "@shared/logger/logger";

import type { MeliAuthRepository } from "./meli-auth.repository";

interface MeliTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
  user_id: number;
  refresh_token: string;
}

export class MeliAuthService {
  private readonly logger = createLogger("meli-auth");

  constructor(private readonly repository: MeliAuthRepository) {}

  getAuthUrl(userId: string): string {
    const { MELI_APP_ID, MELI_REDIRECT_URI } = env();

    return (
      `https://auth.mercadolibre.com.ar/authorization` +
      `?response_type=code` +
      `&client_id=${MELI_APP_ID}` +
      `&redirect_uri=${encodeURIComponent(MELI_REDIRECT_URI)}` +
      `&state=${userId}`
    );
  }

  async handleCallback(code: string, userId: string): Promise<void> {
    this.logger.info(`Handling MercadoLibre OAuth callback for user: ${userId}`);

    const { MELI_APP_ID, MELI_CLIENT_SECRET, MELI_REDIRECT_URI } = env();

    const response = await fetch("https://api.mercadolibre.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: MELI_APP_ID!,
        client_secret: MELI_CLIENT_SECRET!,
        code,
        redirect_uri: MELI_REDIRECT_URI
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`MercadoLibre token exchange failed: ${response.status} ${error}`);
    }

    const tokens = (await response.json()) as MeliTokenResponse;

    await this.repository.saveToken(userId, {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      scope: tokens.scope || "",
      tokenType: tokens.token_type || "Bearer",
      mlUserId: String(tokens.user_id)
    });

    this.logger.info(`MercadoLibre OAuth tokens saved for user: ${userId}`);
  }

  async getAccessToken(userId: string): Promise<{ accessToken: string; mlUserId: string }> {
    const token = await this.repository.findByUserId(userId);

    if (!token) {
      throw new Error("MercadoLibre not authenticated for this user");
    }

    // Refresh if expiring within 1 minute
    if (token.expiresAt.getTime() < Date.now() + 60000) {
      await this.refreshToken(userId, token.refreshToken, token.mlUserId);
      const refreshed = await this.repository.findByUserId(userId);
      if (!refreshed) throw new Error("Failed to refresh MercadoLibre token");
      return { accessToken: refreshed.accessToken, mlUserId: refreshed.mlUserId };
    }

    return { accessToken: token.accessToken, mlUserId: token.mlUserId };
  }

  private async refreshToken(
    userId: string,
    refreshToken: string,
    mlUserId: string
  ): Promise<void> {
    this.logger.info(`Refreshing MercadoLibre token for user: ${userId}`);

    const { MELI_APP_ID, MELI_CLIENT_SECRET } = env();

    const response = await fetch("https://api.mercadolibre.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: MELI_APP_ID!,
        client_secret: MELI_CLIENT_SECRET!,
        refresh_token: refreshToken
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`MercadoLibre token refresh failed: ${response.status} ${error}`);
    }

    const tokens = (await response.json()) as MeliTokenResponse;

    await this.repository.saveToken(userId, {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      scope: tokens.scope || "",
      tokenType: tokens.token_type || "Bearer",
      mlUserId: String(tokens.user_id) || mlUserId
    });

    this.logger.info(`MercadoLibre token refreshed for user: ${userId}`);
  }

  async isAuthenticated(userId: string): Promise<boolean> {
    const token = await this.repository.findByUserId(userId);
    return !!token;
  }

  async revokeAccess(userId: string): Promise<void> {
    this.logger.info(`Revoking MercadoLibre access for user: ${userId}`);
    await this.repository.deleteByUserId(userId);
    this.logger.info(`MercadoLibre access revoked for user: ${userId}`);
  }
}
