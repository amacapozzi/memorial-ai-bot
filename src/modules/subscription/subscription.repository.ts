import type { PrismaClient } from "@prisma-module/generated/client";

export interface UserSubscriptionInfo {
  hasLinkedAccount: boolean;
  hasActiveSubscription: boolean;
  planName: string | null;
  status: string | null;
  hasEmailSync: boolean;
  hasEmailReply: boolean;
  hasCalendarSync: boolean;
  maxReminders: number | null;
  currentReminderCount: number;
  periodEnd: Date | null;
  trialEndsAt: Date | null;
}

export class SubscriptionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getUserSubscriptionInfo(chatId: string): Promise<UserSubscriptionInfo> {
    const user = await this.prisma.user.findUnique({
      where: { chatId },
      select: {
        id: true,
        email: true,
        subscription: {
          select: {
            status: true,
            currentPeriodEnd: true,
            trialEndsAt: true,
            plan: {
              select: {
                name: true,
                maxReminders: true,
                hasEmailSync: true,
                hasEmailReply: true,
                hasCalendarSync: true
              }
            }
          }
        }
      }
    });

    if (!user) {
      return {
        hasLinkedAccount: false,
        hasActiveSubscription: false,
        planName: null,
        status: null,
        hasEmailSync: false,
        hasEmailReply: false,
        hasCalendarSync: false,
        maxReminders: null,
        currentReminderCount: 0,
        periodEnd: null,
        trialEndsAt: null
      };
    }

    // User exists but has no email = bot-created user, not linked via website
    const hasLinkedAccount = !!user.email;
    const sub = user.subscription;
    const hasActiveSubscription = !!sub && (sub.status === "ACTIVE" || sub.status === "TRIALING");

    const currentReminderCount = await this.prisma.reminder.count({
      where: { chatId, status: "PENDING" }
    });

    return {
      hasLinkedAccount,
      hasActiveSubscription,
      planName: sub?.plan.name ?? null,
      status: sub?.status ?? null,
      hasEmailSync: sub?.plan.hasEmailSync ?? false,
      hasEmailReply: sub?.plan.hasEmailReply ?? false,
      hasCalendarSync: sub?.plan.hasCalendarSync ?? false,
      maxReminders: sub?.plan.maxReminders ?? null,
      currentReminderCount,
      periodEnd: sub?.currentPeriodEnd ?? null,
      trialEndsAt: sub?.trialEndsAt ?? null
    };
  }
}
