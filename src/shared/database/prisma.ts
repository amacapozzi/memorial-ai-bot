import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@prisma-module/generated/client";
import { env } from "@shared/env/env";

let prismaClient: PrismaClient | null = null;

export function getPrismaClient(): PrismaClient {
  if (!prismaClient) {
    const adapter = new PrismaPg({ connectionString: env().DATABASE_URL });
    prismaClient = new PrismaClient({ adapter });
  }
  return prismaClient;
}

export async function disconnectPrisma(): Promise<void> {
  if (prismaClient) {
    await prismaClient.$disconnect();
    prismaClient = null;
  }
}
