import type { User } from "@prisma-module/generated/client";
import { createLogger } from "@shared/logger/logger";

import type { UserRepository } from "./user.repository";

const logger = createLogger("user-service");

export class UserService {
  constructor(private readonly userRepository: UserRepository) {}

  async getOrCreateUser(chatId: string): Promise<User> {
    logger.debug(`Getting or creating user for chatId: ${chatId}`);
    return this.userRepository.findOrCreate(chatId);
  }

  async getUserByChatId(chatId: string): Promise<User | null> {
    return this.userRepository.findByChatId(chatId);
  }

  async getUserById(id: string): Promise<User | null> {
    return this.userRepository.findById(id);
  }

  async hasEmailLinked(chatId: string): Promise<boolean> {
    const users = await this.userRepository.findAllWithEmailTokens();
    return users.some((user) => user.chatId === chatId);
  }

  async getUsersWithEmailLinked(): Promise<User[]> {
    return this.userRepository.findAllWithEmailTokens();
  }
}
