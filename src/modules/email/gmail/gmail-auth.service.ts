import { google, type Auth } from "googleapis";

import { env } from "@shared/env/env";
import { createLogger } from "@shared/logger/logger";

import type { GmailAuthRepository } from "./gmail-auth.repository";

const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";

function getGmailScopes(includeSend: boolean): string[] {
  const scopes = [GMAIL_READONLY_SCOPE];
  if (includeSend) {
    scopes.push(GMAIL_SEND_SCOPE);
  }
  return scopes;
}

export class GmailAuthService {
  private readonly logger = createLogger("gmail-auth");

  constructor(private readonly repository: GmailAuthRepository) {}

  private createOAuth2Client(): Auth.OAuth2Client {
    const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GMAIL_REDIRECT_URI } = env();

    return new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GMAIL_REDIRECT_URI);
  }

  getAuthUrl(userId: string, includeSend: boolean = false): string {
    const oauth2Client = this.createOAuth2Client();

    return oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: getGmailScopes(includeSend),
      prompt: "consent",
      state: userId // Pass userId to identify user on callback
    });
  }

  async handleCallback(code: string, userId: string): Promise<void> {
    this.logger.info(`Handling Gmail OAuth callback for user: ${userId}`);

    const oauth2Client = this.createOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.access_token || !tokens.refresh_token) {
      throw new Error("Failed to get tokens from Google");
    }

    await this.repository.saveToken(userId, {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: new Date(tokens.expiry_date || Date.now() + 3600000),
      scope: tokens.scope || getGmailScopes(false).join(" "),
      tokenType: tokens.token_type || "Bearer"
    });

    this.logger.info(`Gmail OAuth tokens saved for user: ${userId}`);
  }

  async getAuthClient(userId: string): Promise<Auth.OAuth2Client> {
    const token = await this.repository.findByUserId(userId);

    if (!token) {
      throw new Error("Gmail not authenticated for this user");
    }

    const oauth2Client = this.createOAuth2Client();

    oauth2Client.setCredentials({
      access_token: token.accessToken,
      refresh_token: token.refreshToken,
      expiry_date: token.expiresAt.getTime(),
      token_type: token.tokenType,
      scope: token.scope
    });

    // Check if token needs refresh (within 1 minute of expiry)
    if (token.expiresAt.getTime() < Date.now() + 60000) {
      await this.refreshToken(userId, oauth2Client);
    }

    return oauth2Client;
  }

  private async refreshToken(userId: string, oauth2Client: Auth.OAuth2Client): Promise<void> {
    this.logger.info(`Refreshing Gmail OAuth token for user: ${userId}`);

    const { credentials } = await oauth2Client.refreshAccessToken();

    if (!credentials.access_token) {
      throw new Error("Failed to refresh Gmail token");
    }

    const currentToken = await this.repository.findByUserId(userId);

    await this.repository.saveToken(userId, {
      accessToken: credentials.access_token,
      refreshToken: credentials.refresh_token || currentToken?.refreshToken || "",
      expiresAt: new Date(credentials.expiry_date || Date.now() + 3600000),
      scope: credentials.scope || getGmailScopes(false).join(" "),
      tokenType: credentials.token_type || "Bearer"
    });

    this.logger.info(`Gmail OAuth token refreshed for user: ${userId}`);
  }

  async isAuthenticated(userId: string): Promise<boolean> {
    const token = await this.repository.findByUserId(userId);
    return !!token;
  }

  async hasSendScope(userId: string): Promise<boolean> {
    const token = await this.repository.findByUserId(userId);
    if (!token) return false;
    return token.scope.includes(GMAIL_SEND_SCOPE);
  }

  async revokeAccess(userId: string): Promise<void> {
    this.logger.info(`Revoking Gmail access for user: ${userId}`);

    const token = await this.repository.findByUserId(userId);

    if (token) {
      try {
        const oauth2Client = this.createOAuth2Client();
        oauth2Client.setCredentials({ access_token: token.accessToken });
        await oauth2Client.revokeToken(token.accessToken);
      } catch (error) {
        this.logger.warn(`Failed to revoke token on Google side: ${error}`);
      }

      await this.repository.deleteByUserId(userId);
    }

    this.logger.info(`Gmail access revoked for user: ${userId}`);
  }

  async getHistoryId(userId: string): Promise<string | null> {
    const token = await this.repository.findByUserId(userId);
    return token?.historyId || null;
  }

  async updateHistoryId(userId: string, historyId: string): Promise<void> {
    await this.repository.updateHistoryId(userId, historyId);
  }
}
