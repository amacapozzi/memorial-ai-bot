import type { PrismaClient, WhatsAppSession } from "@prisma-module/generated/client";

export class SessionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<WhatsAppSession | null> {
    return this.prisma.whatsAppSession.findUnique({ where: { id } });
  }

  async upsert(id: string, data: unknown): Promise<WhatsAppSession> {
    return this.prisma.whatsAppSession.upsert({
      where: { id },
      update: { data: data as object },
      create: { id, data: data as object }
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.whatsAppSession.delete({ where: { id } }).catch(() => {
      // Ignore if not found
    });
  }
}
