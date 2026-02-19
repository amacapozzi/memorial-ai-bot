import type { Boom } from "@hapi/boom";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  type WASocket,
  type BaileysEventMap,
  type WAProto,
  downloadMediaMessage,
  getAggregateVotesInPollMessage
} from "@whiskeysockets/baileys";

import { env } from "@shared/env/env";
import { createLogger } from "@shared/logger/logger";

import type { ButtonOption, ListSection, MessageContent } from "./whatsapp.types";
import type { QRHandler } from "../handlers/qr.handler";
import type { SessionService } from "../session/session.service";

export type MessageHandler = (message: MessageContent) => Promise<void>;

// Silent logger for baileys
const silentLogger = {
  level: "silent" as const,
  child: () => silentLogger,
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {}
};

interface StoredPoll {
  sentMsg: WAProto.IWebMessageInfo;
  options: ButtonOption[];
  pollUpdates: WAProto.IPollUpdate[];
}

export class WhatsAppClient {
  private socket: WASocket | null = null;
  private messageHandler: MessageHandler | null = null;
  private readonly logger = createLogger("whatsapp");
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 10;
  private reconnecting = false;
  private readonly pollStore = new Map<string, StoredPoll>();

  constructor(
    private readonly sessionService: SessionService,
    private readonly qrHandler: QRHandler
  ) {}

  async connect(): Promise<void> {
    this.logger.info("Connecting to WhatsApp...");

    // Clean up previous socket to prevent duplicate event listeners
    this.cleanup();

    const { state, saveCreds } = await this.sessionService.getAuthState();

    this.socket = makeWASocket({
      auth: state,
      browser: Browsers.ubuntu("Chrome"),
      printQRInTerminal: false,
      keepAliveIntervalMs: 30_000,
      connectTimeoutMs: 60_000,
      retryRequestDelayMs: 2000,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      logger: silentLogger as any
    });

    this.socket.ev.on("creds.update", saveCreds);
    this.socket.ev.on("connection.update", (update) => this.handleConnectionUpdate(update));
    this.socket.ev.on("messages.upsert", (m) => this.handleMessages(m));
    this.socket.ev.on("messages.update", (updates) => this.handlePollUpdates(updates));
  }

  async disconnect(): Promise<void> {
    this.cleanup();
    this.logger.info("Disconnected from WhatsApp");
  }

  private cleanup(): void {
    if (this.socket) {
      this.socket.ev.removeAllListeners("creds.update");
      this.socket.ev.removeAllListeners("connection.update");
      this.socket.ev.removeAllListeners("messages.upsert");
      this.socket.ev.removeAllListeners("messages.update");
      this.socket.end(undefined);
      this.socket = null;
    }
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  async sendMessage(chatId: string, text: string): Promise<void> {
    if (!this.socket) {
      throw new Error("WhatsApp not connected");
    }

    await this.socket.sendMessage(chatId, { text });
    this.logger.debug(`Message sent to ${chatId}`);
  }

  async sendButtons(
    chatId: string,
    text: string,
    buttons: ButtonOption[],
    footer?: string
  ): Promise<void> {
    if (!this.socket) {
      throw new Error("WhatsApp not connected");
    }

    await this.socket.sendMessage(chatId, {
      buttonsMessage: {
        contentText: text,
        footerText: footer,
        headerType: 1, // EMPTY
        buttons: buttons.map((b) => ({
          buttonId: b.id,
          buttonText: { displayText: b.text },
          type: 1 // RESPONSE
        }))
      }
    } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    this.logger.debug(`Buttons message sent to ${chatId}`);
  }

  async sendList(
    chatId: string,
    title: string,
    body: string,
    buttonText: string,
    sections: ListSection[],
    footer?: string
  ): Promise<void> {
    if (!this.socket) {
      throw new Error("WhatsApp not connected");
    }

    await this.socket.sendMessage(chatId, {
      listMessage: {
        title,
        description: body,
        buttonText,
        listType: 1, // SINGLE_SELECT
        sections: sections.map((s) => ({
          title: s.title,
          rows: s.rows.map((r) => ({ rowId: r.id, title: r.title, description: r.description }))
        })),
        footerText: footer
      }
    } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    this.logger.debug(`List message sent to ${chatId}`);
  }

  async sendPoll(chatId: string, question: string, options: ButtonOption[]): Promise<void> {
    if (!this.socket) {
      throw new Error("WhatsApp not connected");
    }

    const sent = await this.socket.sendMessage(chatId, {
      poll: {
        name: question,
        values: options.map((o) => o.text),
        selectableCount: 1
      }
    });

    if (sent?.key?.id) {
      this.pollStore.set(sent.key.id, { sentMsg: sent, options, pollUpdates: [] });
    }

    this.logger.debug(`Poll sent to ${chatId}`);
  }

  private async handlePollUpdates(updates: BaileysEventMap["messages.update"]): Promise<void> {
    if (!this.messageHandler) return;

    for (const { key, update } of updates) {
      if (!update.pollUpdates?.length) continue;

      const pollId = key.id ?? "";
      const stored = this.pollStore.get(pollId);
      if (!stored) continue;

      // Accumulate all updates
      stored.pollUpdates.push(...update.pollUpdates);

      try {
        const votes = getAggregateVotesInPollMessage({
          message: stored.sentMsg.message,
          pollUpdates: stored.pollUpdates
        });

        const selected = votes.find((v) => v.voters.length > 0);
        if (!selected) continue;

        const option = stored.options.find((o) => o.text === selected.name);
        if (!option) continue;

        const chatId = key.remoteJid ?? "";
        if (!chatId) continue;

        await this.messageHandler({
          type: "pollResponse",
          selectedButtonId: option.id,
          chatId,
          messageId: pollId,
          fromMe: key.fromMe ?? false,
          timestamp: new Date()
        });
      } catch (err) {
        this.logger.error("Failed to process poll vote", err);
      }
    }
  }

  private handleConnectionUpdate(update: BaileysEventMap["connection.update"]): void {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      this.qrHandler.displayQR(qr);
    }

    if (connection === "close") {
      const reason = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const errorMsg = (lastDisconnect?.error as Boom)?.message || "unknown";

      this.logger.warn(`Connection closed: reason=${reason} (${errorMsg})`);

      if (reason === DisconnectReason.loggedOut) {
        this.logger.warn("Logged out from WhatsApp. Please scan QR code again.");
        this.sessionService.clearSession();
        this.reconnectAttempts = 0;
        this.reconnecting = false;
        this.connect();
        return;
      }

      // Don't reconnect if another device took over
      if (reason === DisconnectReason.connectionReplaced) {
        this.logger.warn("Connection replaced by another session. Not reconnecting.");
        this.reconnecting = false;
        return;
      }

      // Guard against concurrent reconnection attempts
      if (this.reconnecting) {
        this.logger.debug("Already reconnecting, ignoring duplicate close event");
        return;
      }

      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnecting = true;
        this.reconnectAttempts++;

        // Exponential backoff: 2s, 4s, 8s, 16s, 32s... capped at 60s
        const delay = Math.min(2000 * Math.pow(2, this.reconnectAttempts - 1), 60_000);

        this.logger.info(
          `Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`
        );

        setTimeout(() => {
          this.reconnecting = false;
          this.connect();
        }, delay);
      } else {
        this.logger.error("Max reconnection attempts reached. Please restart the bot.");
      }
    } else if (connection === "open") {
      this.reconnectAttempts = 0;
      this.reconnecting = false;
      this.logger.info("Connected to WhatsApp!");
    }
  }

  private async handleMessages(m: BaileysEventMap["messages.upsert"]): Promise<void> {
    if (!this.messageHandler) return;

    for (const msg of m.messages) {
      // Skip status updates
      if (msg.key.remoteJid === "status@broadcast") continue;

      // Check if message is from allowed phone number
      const allowedPhone = env().ALLOWED_PHONE_NUMBER;
      if (allowedPhone) {
        const sender = msg.key.remoteJid?.replace("@s.whatsapp.net", "");
        if (sender !== allowedPhone && !msg.key.fromMe) {
          this.logger.debug(`Ignoring message from unauthorized number: ${sender}`);
          continue;
        }
      }

      const content = await this.extractMessageContent(msg);
      if (content) {
        try {
          await this.messageHandler(content);
        } catch (error) {
          this.logger.error("Error handling message", error);
        }
      }
    }
  }

  private async extractMessageContent(
    msg: BaileysEventMap["messages.upsert"]["messages"][0]
  ): Promise<MessageContent | null> {
    const chatId = msg.key.remoteJid;
    if (!chatId) return null;

    const messageId = msg.key.id ?? "";
    const fromMe = msg.key.fromMe ?? false;
    const timestamp = new Date((msg.messageTimestamp as number) * 1000);

    const message = msg.message;
    if (!message) return null;

    // Text message
    if (message.conversation || message.extendedTextMessage?.text) {
      return {
        type: "text",
        text: message.conversation ?? message.extendedTextMessage?.text ?? undefined,
        chatId,
        messageId,
        fromMe,
        timestamp
      };
    }

    // Audio message (voice note or audio file)
    if (message.audioMessage) {
      try {
        const buffer = await downloadMediaMessage(msg, "buffer", {});
        return {
          type: "audio",
          audioBuffer: buffer as Buffer,
          mimeType: message.audioMessage.mimetype ?? "audio/ogg",
          chatId,
          messageId,
          fromMe,
          timestamp
        };
      } catch (error) {
        this.logger.error("Failed to download audio", error);
        return null;
      }
    }

    // Button response
    if (message.buttonsResponseMessage) {
      return {
        type: "buttonResponse",
        selectedButtonId: message.buttonsResponseMessage.selectedButtonId ?? undefined,
        chatId,
        messageId,
        fromMe,
        timestamp
      };
    }

    // List response
    if (message.listResponseMessage) {
      return {
        type: "listResponse",
        selectedRowId: message.listResponseMessage.singleSelectReply?.selectedRowId ?? undefined,
        chatId,
        messageId,
        fromMe,
        timestamp
      };
    }

    // Other message types we don't handle yet
    return {
      type: "unknown",
      chatId,
      messageId,
      fromMe,
      timestamp
    };
  }
}
