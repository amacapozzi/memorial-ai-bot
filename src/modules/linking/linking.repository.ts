import type { PrismaClient, LinkingCode } from "@prisma-module/generated/client";

export class LinkingCodeRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(code: string, chatId: string, expiresAt: Date): Promise<LinkingCode> {
    return this.prisma.linkingCode.create({
      data: { code, chatId, expiresAt }
    });
  }

  async findValidCode(code: string): Promise<LinkingCode | null> {
    return this.prisma.linkingCode.findFirst({
      where: {
        code,
        expiresAt: { gt: new Date() },
        usedAt: null
      }
    });
  }

  async markUsed(id: string, usedBy: string): Promise<LinkingCode> {
    return this.prisma.linkingCode.update({
      where: { id },
      data: { usedAt: new Date(), usedBy }
    });
  }

  async deleteExpired(): Promise<number> {
    const result = await this.prisma.linkingCode.deleteMany({
      where: {
        OR: [{ expiresAt: { lt: new Date() } }, { usedAt: { not: null } }]
      }
    });
    return result.count;
  }

  async deleteByChatId(chatId: string): Promise<number> {
    const result = await this.prisma.linkingCode.deleteMany({
      where: { chatId }
    });
    return result.count;
  }
}
