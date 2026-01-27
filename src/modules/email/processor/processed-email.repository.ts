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

  async existsByGmailId(userId: string, gmailMessageId: string): Promise<boolean> {
    const count = await this.prisma.processedEmail.count({
      where: {
        userId,
        gmailMessageId
      }
    });
    return count > 0;
  }
}
