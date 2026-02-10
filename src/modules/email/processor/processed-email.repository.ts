import type {
  PrismaClient,
  ProcessedEmail,
  EmailType,
  ProcessedEmailStatus,
  Prisma
} from "@prisma-module/generated/client";

export interface CreateProcessedEmailData {
  userId: string;
  gmailMessageId: string;
  threadId?: string;
  subject?: string;
  sender?: string;
  receivedAt: Date;
  emailType: EmailType;
  extractedData?: Record<string, unknown>;
  reminderId?: string;
  status?: ProcessedEmailStatus;
}

export class ProcessedEmailRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(data: CreateProcessedEmailData): Promise<ProcessedEmail> {
    return this.prisma.processedEmail.create({
      data: {
        userId: data.userId,
        gmailMessageId: data.gmailMessageId,
        threadId: data.threadId,
        subject: data.subject,
        sender: data.sender,
        receivedAt: data.receivedAt,
        emailType: data.emailType,
        extractedData: data.extractedData as Prisma.InputJsonValue | undefined,
        reminderId: data.reminderId,
        status: data.status || "PROCESSED"
      }
    });
  }

  async findByGmailId(userId: string, gmailMessageId: string): Promise<ProcessedEmail | null> {
    return this.prisma.processedEmail.findUnique({
      where: {
        userId_gmailMessageId: {
          userId,
          gmailMessageId
        }
      }
    });
  }

  async findByUserId(userId: string, limit: number = 20): Promise<ProcessedEmail[]> {
    return this.prisma.processedEmail.findMany({
      where: { userId },
      orderBy: { processedAt: "desc" },
      take: limit
    });
  }

  async updateStatus(
    id: string,
    status: ProcessedEmailStatus,
    reminderId?: string
  ): Promise<ProcessedEmail> {
    return this.prisma.processedEmail.update({
      where: { id },
      data: {
        status,
        reminderId
      }
    });
  }

  async findRecentForChat(userId: string, limit: number = 1): Promise<ProcessedEmail[]> {
    return this.prisma.processedEmail.findMany({
      where: { userId, status: { not: "SKIPPED" } },
      orderBy: { processedAt: "desc" },
      take: limit
    });
  }

  async searchByKeywords(
    userId: string,
    keywords: string,
    limit: number = 5
  ): Promise<ProcessedEmail[]> {
    // Clean Gmail operators and extract raw terms
    const terms = keywords
      .replace(/(?:from|to|subject|in|is|has|label):\S*/gi, "")
      .split(/\s+/)
      .filter((t) => t.length > 0);

    // Also extract from: values as sender search terms
    const fromMatches = keywords.match(/from:(\S+)/gi) || [];
    const fromTerms = fromMatches.map((m) => m.replace(/^from:/i, ""));

    const conditions: Prisma.ProcessedEmailWhereInput[] = [];

    for (const term of terms) {
      conditions.push(
        { subject: { contains: term, mode: "insensitive" } },
        { sender: { contains: term, mode: "insensitive" } }
      );
    }

    for (const from of fromTerms) {
      conditions.push({ sender: { contains: from, mode: "insensitive" } });
    }

    if (conditions.length === 0) {
      return [];
    }

    return this.prisma.processedEmail.findMany({
      where: {
        userId,
        OR: conditions
      },
      orderBy: { receivedAt: "desc" },
      take: limit
    });
  }

  async existsByGmailId(userId: string, gmailMessageId: string): Promise<boolean> {
    const count = await this.prisma.processedEmail.count({
      where: {
        userId,
        gmailMessageId
      }
    });
    return count > 0;
  }

  async existsByGmailIds(userId: string, gmailMessageIds: string[]): Promise<Set<string>> {
    if (gmailMessageIds.length === 0) return new Set();

    const existing = await this.prisma.processedEmail.findMany({
      where: {
        userId,
        gmailMessageId: { in: gmailMessageIds }
      },
      select: { gmailMessageId: true }
    });

    return new Set(existing.map((e) => e.gmailMessageId));
  }
}
