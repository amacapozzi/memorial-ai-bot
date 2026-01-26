import type { PrismaClient, GoogleAuthToken } from "@prisma-module/generated/client";

export interface TokenData {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scope: string;
  tokenType?: string;
}

export class GoogleAuthRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findToken(): Promise<GoogleAuthToken | null> {
    return this.prisma.googleAuthToken.findUnique({ where: { id: "default" } });
  }

  async saveToken(data: TokenData): Promise<GoogleAuthToken> {
    return this.prisma.googleAuthToken.upsert({
      where: { id: "default" },
      update: {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        expiresAt: data.expiresAt,
        scope: data.scope,
        tokenType: data.tokenType || "Bearer"
      },
      create: {
        id: "default",
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        expiresAt: data.expiresAt,
        scope: data.scope,
        tokenType: data.tokenType || "Bearer"
      }
    });
  }

  async deleteToken(): Promise<void> {
    await this.prisma.googleAuthToken.delete({ where: { id: "default" } }).catch(() => {
      // Ignore if not found
    });
  }
}
