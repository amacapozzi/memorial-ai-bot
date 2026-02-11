import type { PrismaClient } from "@prisma-module/generated/client";

export interface CommitData {
  sha: string;
  message: string;
  author: string;
  url: string;
  repository: string;
  branch: string;
  timestamp: Date;
}

export class CommitRepository {
  constructor(private prisma: PrismaClient) {}

  async createMany(commits: CommitData[]) {
    return this.prisma.commit.createMany({
      data: commits,
      skipDuplicates: true
    });
  }

  async findByRepo(repository: string, limit = 50) {
    return this.prisma.commit.findMany({
      where: { repository },
      orderBy: { timestamp: "desc" },
      take: limit
    });
  }
}
