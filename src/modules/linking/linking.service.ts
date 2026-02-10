import { createLogger } from "@shared/logger/logger";

import type { LinkingCodeRepository } from "./linking.repository";

const CODE_LENGTH = 6;
const CODE_TTL_MINUTES = 5;

export class LinkingCodeService {
  private readonly logger = createLogger("linking-code");

  constructor(private readonly repository: LinkingCodeRepository) {}

  async generateCode(chatId: string): Promise<string> {
    // Delete any existing codes for this chatId
    await this.repository.deleteByChatId(chatId);

    const code = this.createRandomCode();
    const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000);

    await this.repository.create(code, chatId, expiresAt);
    this.logger.info(`Linking code generated for ${chatId}`);

    return code;
  }

  async cleanupExpired(): Promise<void> {
    const count = await this.repository.deleteExpired();
    if (count > 0) {
      this.logger.debug(`Cleaned up ${count} expired/used linking codes`);
    }
  }

  private createRandomCode(): string {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I to avoid confusion
    let code = "";
    for (let i = 0; i < CODE_LENGTH; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }
}
