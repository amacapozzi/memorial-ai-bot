import { google, type Auth } from "googleapis";

import { env } from "@shared/env/env";
import { createLogger } from "@shared/logger/logger";

import type { GoogleAuthRepository } from "./google-auth.repository";

const SCOPES = ["https://www.googleapis.com/auth/calendar"];

export class GoogleAuthService {
  private oauth2Client: Auth.OAuth2Client;
  private readonly logger = createLogger("google-auth");

  constructor(private readonly repository: GoogleAuthRepository) {
    const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = env();

    this.oauth2Client = new google.auth.OAuth2(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      GOOGLE_REDIRECT_URI
    );
  }

  getAuthUrl(): string {
    return this.oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: SCOPES,
      prompt: "consent" // Force to get refresh token
    });
  }

  async handleCallback(code: string): Promise<void> {
    this.logger.info("Handling OAuth callback...");

    const { tokens } = await this.oauth2Client.getToken(code);

    if (!tokens.access_token || !tokens.refresh_token) {
      throw new Error("Failed to get tokens from Google");
    }

    await this.repository.saveToken({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: new Date(tokens.expiry_date || Date.now() + 3600000),
      scope: tokens.scope || SCOPES.join(" "),
      tokenType: tokens.token_type || "Bearer"
    });

    this.oauth2Client.setCredentials(tokens);
    this.logger.info("Google OAuth tokens saved successfully");
  }

  async getAuthClient(): Promise<Auth.OAuth2Client> {
    const token = await this.repository.findToken();

    if (!token) {
      throw new Error(
        "Google Calendar not authenticated. Please visit /auth/google to authenticate."
      );
    }

    this.oauth2Client.setCredentials({
      access_token: token.accessToken,
      refresh_token: token.refreshToken,
      expiry_date: token.expiresAt.getTime(),
      token_type: token.tokenType,
      scope: token.scope
    });

    // Check if token needs refresh
    if (token.expiresAt.getTime() < Date.now() + 60000) {
      await this.refreshToken();
    }

    return this.oauth2Client;
  }

  private async refreshToken(): Promise<void> {
    this.logger.info("Refreshing Google OAuth token...");

    const { credentials } = await this.oauth2Client.refreshAccessToken();

    if (!credentials.access_token) {
      throw new Error("Failed to refresh Google token");
    }

    await this.repository.saveToken({
      accessToken: credentials.access_token,
      refreshToken: credentials.refresh_token || "",
      expiresAt: new Date(credentials.expiry_date || Date.now() + 3600000),
      scope: credentials.scope || SCOPES.join(" "),
      tokenType: credentials.token_type || "Bearer"
    });

    this.logger.info("Google OAuth token refreshed");
  }

  async isAuthenticated(): Promise<boolean> {
    const token = await this.repository.findToken();
    return !!token;
  }
}
