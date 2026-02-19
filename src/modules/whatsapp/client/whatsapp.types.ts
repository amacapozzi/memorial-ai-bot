import type { proto } from "@whiskeysockets/baileys";

export type WAMessage = proto.IWebMessageInfo;

export interface MessageContent {
  type:
    | "text"
    | "audio"
    | "image"
    | "video"
    | "document"
    | "buttonResponse"
    | "listResponse"
    | "unknown";
  text?: string;
  audioBuffer?: Buffer;
  mimeType?: string;
  selectedButtonId?: string;
  selectedRowId?: string;
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

export interface ButtonOption {
  id: string;
  text: string;
}

export interface ListRow {
  id: string;
  title: string;
  description?: string;
}

export interface ListSection {
  title?: string;
  rows: ListRow[];
}
