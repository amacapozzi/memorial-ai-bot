import type { PrismaClient, User } from "@prisma-module/generated/client";

export class UserRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async findByChatId(chatId: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { chatId } });
  }

  async findOrCreate(chatId: string): Promise<User> {
    return this.prisma.user.upsert({
      where: { chatId },
      create: { chatId },
      update: {}
    });
  }

  async findAllWithEmailTokens(): Promise<User[]> {
    return this.prisma.user.findMany({
      where: {
        emailToken: { isNot: null }
      },
      include: { emailToken: true }
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.user.delete({ where: { id } });
  }
}
