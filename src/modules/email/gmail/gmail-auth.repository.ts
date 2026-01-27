import type { PrismaClient, EmailToken } from "@prisma-module/generated/client";

export interface EmailTokenData {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scope: string;
  tokenType?: string;
}

export class GmailAuthRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByUserId(userId: string): Promise<EmailToken | null> {
    return this.prisma.emailToken.findUnique({ where: { userId } });
  }

  async saveToken(userId: string, data: EmailTokenData): Promise<EmailToken> {
    return this.prisma.emailToken.upsert({
      where: { userId },
      update: {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        expiresAt: data.expiresAt,
        scope: data.scope,
        tokenType: data.tokenType || "Bearer"
      },
      create: {
        userId,
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        expiresAt: data.expiresAt,
        scope: data.scope,
        tokenType: data.tokenType || "Bearer"
      }
    });
  }

  async updateHistoryId(userId: string, historyId: string): Promise<EmailToken> {
    return this.prisma.emailToken.update({
      where: { userId },
      data: { historyId, lastSyncAt: new Date() }
    });
  }

  async updateLastSync(userId: string): Promise<void> {
    await this.prisma.emailToken.update({
      where: { userId },
      data: { lastSyncAt: new Date() }
    });
  }

  async deleteByUserId(userId: string): Promise<void> {
    await this.prisma.emailToken.delete({ where: { userId } }).catch(() => {
      // Ignore if not found
    });
  }
}
