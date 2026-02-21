import type { PrismaClient, MercadoLibreToken } from "@prisma-module/generated/client";

export interface MeliTokenData {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scope: string;
  tokenType?: string;
  mlUserId: string;
}

export class MeliAuthRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByUserId(userId: string): Promise<MercadoLibreToken | null> {
    return this.prisma.mercadoLibreToken.findUnique({ where: { userId } });
  }

  async saveToken(userId: string, data: MeliTokenData): Promise<MercadoLibreToken> {
    return this.prisma.mercadoLibreToken.upsert({
      where: { userId },
      update: {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        expiresAt: data.expiresAt,
        scope: data.scope,
        tokenType: data.tokenType || "Bearer",
        mlUserId: data.mlUserId
      },
      create: {
        userId,
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        expiresAt: data.expiresAt,
        scope: data.scope,
        tokenType: data.tokenType || "Bearer",
        mlUserId: data.mlUserId
      }
    });
  }

  async deleteByUserId(userId: string): Promise<void> {
    await this.prisma.mercadoLibreToken.delete({ where: { userId } }).catch(() => {
      // Ignore if not found
    });
  }
}
