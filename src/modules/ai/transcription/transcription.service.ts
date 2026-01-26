import { createLogger } from "@shared/logger/logger";

import type { GroqClient } from "../groq/groq.client";

export class TranscriptionService {
  private readonly logger = createLogger("transcription");

  constructor(private readonly groqClient: GroqClient) {}

  async transcribe(audioBuffer: Buffer, mimeType: string): Promise<string> {
    this.logger.info(`Transcribing audio (${audioBuffer.length} bytes, ${mimeType})`);

    const text = await this.groqClient.transcribeAudio(audioBuffer, mimeType);

    if (!text || text.trim().length === 0) {
      throw new Error("Empty transcription result");
    }

    this.logger.info(`Transcription result: "${text.substring(0, 100)}..."`);
    return text;
  }
}
