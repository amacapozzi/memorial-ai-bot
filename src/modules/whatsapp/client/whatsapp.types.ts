import type { proto } from "@whiskeysockets/baileys";

export type WAMessage = proto.IWebMessageInfo;

export interface MessageContent {
  type: "text" | "audio" | "image" | "video" | "document" | "unknown";
  text?: string;
  audioBuffer?: Buffer;
  mimeType?: string;
  chatId: string;
  messageId: string;
  fromMe: boolean;
  timestamp: Date;
}

export interface ConnectionStatus {
  isConnected: boolean;
  isConnecting: boolean;
  qrCode?: string;
}
