import { google, type gmail_v1 } from "googleapis";

import { createLogger } from "@shared/logger/logger";

import type { GmailAuthService } from "./gmail-auth.service";

export interface EmailMessage {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  to: string;
  date: Date;
  snippet: string;
  body: string;
}

export class GmailService {
  private readonly logger = createLogger("gmail");

  constructor(private readonly authService: GmailAuthService) {}

  private async getGmail(userId: string): Promise<gmail_v1.Gmail> {
    const auth = await this.authService.getAuthClient(userId);
    return google.gmail({ version: "v1", auth });
  }

  async getCurrentHistoryId(userId: string): Promise<string> {
    const gmail = await this.getGmail(userId);

    const profile = await gmail.users.getProfile({ userId: "me" });

    if (!profile.data.historyId) {
      throw new Error("Failed to get history ID");
    }

    return profile.data.historyId;
  }

  async getNewMessages(userId: string, maxResults: number = 10): Promise<EmailMessage[]> {
    this.logger.debug(`Fetching new messages for user: ${userId}`);

    const gmail = await this.getGmail(userId);

    // Get recent unread messages from inbox
    const response = await gmail.users.messages.list({
      userId: "me",
      maxResults,
      labelIds: ["INBOX"],
      q: "is:unread"
    });

    const messageIds = response.data.messages || [];

    if (messageIds.length === 0) {
      return [];
    }

    const messages: EmailMessage[] = [];

    for (const { id } of messageIds) {
      if (!id) continue;

      try {
        const message = await this.getMessage(userId, id);
        messages.push(message);
      } catch (error) {
        this.logger.warn(`Failed to fetch message ${id}: ${error}`);
      }
    }

    return messages;
  }

  async getMessage(userId: string, messageId: string): Promise<EmailMessage> {
    const gmail = await this.getGmail(userId);

    const response = await gmail.users.messages.get({
      userId: "me",
      id: messageId,
      format: "full"
    });

    const message = response.data;
    const headers = message.payload?.headers || [];

    const getHeader = (name: string): string => {
      const header = headers.find((h) => h.name?.toLowerCase() === name.toLowerCase());
      return header?.value || "";
    };

    const body = this.extractBody(message.payload);

    return {
      id: message.id || messageId,
      threadId: message.threadId || "",
      subject: getHeader("Subject"),
      from: getHeader("From"),
      to: getHeader("To"),
      date: new Date(parseInt(message.internalDate || "0", 10)),
      snippet: message.snippet || "",
      body
    };
  }

  async getMessagesSinceHistoryId(
    userId: string,
    startHistoryId: string
  ): Promise<{ messages: EmailMessage[]; newHistoryId: string }> {
    this.logger.debug(`Fetching messages since historyId: ${startHistoryId}`);

    const gmail = await this.getGmail(userId);

    try {
      const response = await gmail.users.history.list({
        userId: "me",
        startHistoryId,
        historyTypes: ["messageAdded"],
        labelId: "INBOX"
      });

      const newHistoryId = response.data.historyId || startHistoryId;
      const history = response.data.history || [];

      const messageIds = new Set<string>();

      for (const record of history) {
        const added = record.messagesAdded || [];
        for (const msg of added) {
          if (msg.message?.id) {
            messageIds.add(msg.message.id);
          }
        }
      }

      const messages: EmailMessage[] = [];

      for (const id of messageIds) {
        try {
          const message = await this.getMessage(userId, id);
          messages.push(message);
        } catch (error) {
          this.logger.warn(`Failed to fetch message ${id}: ${error}`);
        }
      }

      return { messages, newHistoryId };
    } catch (error: unknown) {
      // If historyId is too old, Gmail returns 404
      // In this case, fall back to getting recent messages
      if (error && typeof error === "object" && "code" in error && error.code === 404) {
        this.logger.warn("History ID too old, fetching recent messages instead");
        const messages = await this.getNewMessages(userId, 5);
        const newHistoryId = await this.getCurrentHistoryId(userId);
        return { messages, newHistoryId };
      }
      throw error;
    }
  }

  private extractBody(payload: gmail_v1.Schema$MessagePart | undefined): string {
    if (!payload) return "";

    // Check for direct body data
    if (payload.body?.data) {
      return this.decodeBase64(payload.body.data);
    }

    // Check parts recursively
    const parts = payload.parts || [];

    // Prefer plain text
    for (const part of parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        return this.decodeBase64(part.body.data);
      }
    }

    // Fall back to HTML (strip tags)
    for (const part of parts) {
      if (part.mimeType === "text/html" && part.body?.data) {
        const html = this.decodeBase64(part.body.data);
        return this.stripHtml(html);
      }
    }

    // Recurse into multipart
    for (const part of parts) {
      const body = this.extractBody(part);
      if (body) return body;
    }

    return "";
  }

  private decodeBase64(data: string): string {
    // Gmail uses URL-safe base64
    const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
    return Buffer.from(base64, "base64").toString("utf-8");
  }

  private stripHtml(html: string): string {
    return html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\s+/g, " ")
      .trim();
  }
}
