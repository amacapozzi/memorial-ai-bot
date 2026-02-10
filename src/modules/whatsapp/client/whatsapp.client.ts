import type { Boom } from "@hapi/boom";
import makeWASocket, {
  DisconnectReason,
  type WASocket,
  type BaileysEventMap,
  downloadMediaMessage
} from "@whiskeysockets/baileys";

import { env } from "@shared/env/env";
import { createLogger } from "@shared/logger/logger";

import type { MessageContent } from "./whatsapp.types";
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

export class WhatsAppClient {
  private socket: WASocket | null = null;
  private messageHandler: MessageHandler | null = null;
  private readonly logger = createLogger("whatsapp");
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 5;

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
      printQRInTerminal: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      logger: silentLogger as any
    });

    this.socket.ev.on("creds.update", saveCreds);
    this.socket.ev.on("connection.update", (update) => this.handleConnectionUpdate(update));
    this.socket.ev.on("messages.upsert", (m) => this.handleMessages(m));
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

  private handleConnectionUpdate(update: BaileysEventMap["connection.update"]): void {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      this.qrHandler.displayQR(qr);
    }

    if (connection === "close") {
      const reason = (lastDisconnect?.error as Boom)?.output?.statusCode;

      if (reason === DisconnectReason.loggedOut) {
        this.logger.warn("Logged out from WhatsApp. Please scan QR code again.");
        this.sessionService.clearSession();
        this.reconnectAttempts = 0;
        this.connect();
      } else if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        this.logger.info(
          `Connection closed. Reconnecting (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`
        );
        setTimeout(() => this.connect(), 3000);
      } else {
        this.logger.error("Max reconnection attempts reached. Please restart the bot.");
      }
    } else if (connection === "open") {
      this.reconnectAttempts = 0;
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
