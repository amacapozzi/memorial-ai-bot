import { env } from "@shared/env/env";
import { createLogger } from "@shared/logger/logger";

import type { GmailAuthService } from "../gmail/gmail-auth.service";
import type { EmailProcessorService } from "../processor/email-processor.service";
import type { UserRepository } from "../user/user.repository";

export class EmailSyncService {
  private intervalId: Timer | null = null;
  private readonly syncIntervalMs: number;
  private readonly logger = createLogger("email-sync");
  private isRunning = false;

  constructor(
    private readonly userRepository: UserRepository,
    private readonly emailProcessorService: EmailProcessorService,
    private readonly gmailAuthService: GmailAuthService
  ) {
    this.syncIntervalMs = env().EMAIL_SYNC_INTERVAL_MS;
  }

  start(): void {
    if (this.intervalId) {
      this.logger.warn("Email sync already running");
      return;
    }

    this.logger.info(`Email sync started (checking every ${this.syncIntervalMs / 1000}s)`);

    // Run immediately on start
    this.tick();

    // Then run on interval
    this.intervalId = setInterval(() => this.tick(), this.syncIntervalMs);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      this.logger.info("Email sync stopped");
    }
  }

  private async tick(): Promise<void> {
    if (this.isRunning) {
      this.logger.debug("Email sync tick skipped (previous tick still running)");
      return;
    }

    this.isRunning = true;

    try {
      await this.syncAllUsers();
    } catch (error) {
      this.logger.error("Error in email sync tick", error);
    } finally {
      this.isRunning = false;
    }
  }

  async syncAllUsers(): Promise<void> {
    const users = await this.userRepository.findAllWithEmailTokens();

    if (users.length === 0) {
      this.logger.debug("No users with email linked");
      return;
    }

    this.logger.info(`Syncing emails for ${users.length} user(s)`);

    for (const user of users) {
      try {
        await this.syncUser(user.id, user.chatId);
      } catch (error) {
        this.logger.error(`Failed to sync user ${user.id}: ${error}`);
      }
    }
  }

  async syncUser(userId: string, chatId: string): Promise<void> {
    this.logger.debug(`Syncing emails for user ${userId}`);

    // Check if user is still authenticated
    const isAuth = await this.gmailAuthService.isAuthenticated(userId);
    if (!isAuth) {
      this.logger.warn(`User ${userId} is not authenticated with Gmail`);
      return;
    }

    // Process new emails
    const processed = await this.emailProcessorService.processNewEmailsForUser(userId, chatId);

    if (processed.length > 0) {
      this.logger.info(`Processed ${processed.length} email(s) for user ${userId}`);
    }
  }
}
