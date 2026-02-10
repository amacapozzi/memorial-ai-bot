import Groq from "groq-sdk";

import { env } from "@shared/env/env";
import { createLogger } from "@shared/logger/logger";

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30000;

export class GroqClient {
  private readonly client: Groq;
  private readonly logger = createLogger("groq");

  constructor() {
    this.client = new Groq({
      apiKey: env().GROQ_API_KEY
    });
  }

  private async withRetry<T>(operation: () => Promise<T>, label: string): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;

        if (attempt === MAX_RETRIES || !this.isRetryable(error)) {
          throw error;
        }

        const delay = this.getRetryDelay(error, attempt);
        this.logger.warn(
          `${label} failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}), retrying in ${delay}ms...`,
          { status: (error as Record<string, unknown>).status }
        );
        await this.sleep(delay);
      }
    }

    throw lastError;
  }

  private isRetryable(error: unknown): boolean {
    if (typeof error !== "object" || error === null) return false;
    const err = error as Record<string, unknown>;
    const status = err.status;

    if (status === 429) {
      // Don't retry if it's a daily/long-term rate limit (retry-after > 60s or message says hours)
      const msg = typeof err.message === "string" ? err.message : "";
      if (msg.includes("tokens per day") || msg.includes("requests per day")) {
        return false;
      }
      const headers = err.headers as Record<string, string> | undefined;
      const retryAfter = headers?.["retry-after"];
      if (retryAfter && Number(retryAfter) > 60) {
        return false;
      }
      // Short-term rate limit (per-minute burst), worth retrying
      return true;
    }

    // 500/502/503/504 = server errors
    if (status === 500 || status === 502 || status === 503 || status === 504) {
      return true;
    }
    // Network errors (no status code)
    if (err.code === "ECONNRESET" || err.code === "ETIMEDOUT") {
      return true;
    }
    return false;
  }

  private getRetryDelay(error: unknown, attempt: number): number {
    // Use Retry-After header if available (GROQ sends this on 429)
    if (typeof error === "object" && error !== null) {
      const headers = (error as Record<string, unknown>).headers as
        | Record<string, string>
        | undefined;
      const retryAfter = headers?.["retry-after"];
      if (retryAfter) {
        const seconds = Number(retryAfter);
        if (!isNaN(seconds) && seconds > 0) {
          return Math.min(seconds * 1000, MAX_DELAY_MS);
        }
      }
    }
    // Exponential backoff with jitter
    const exponential = BASE_DELAY_MS * Math.pow(2, attempt);
    const jitter = Math.random() * BASE_DELAY_MS;
    return Math.min(exponential + jitter, MAX_DELAY_MS);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async transcribeAudio(audioBuffer: Buffer, mimeType: string): Promise<string> {
    this.logger.debug("Transcribing audio with Whisper...");

    const transcription = await this.withRetry(async () => {
      // Convert buffer to File-like object for the API
      const blob = new Blob([new Uint8Array(audioBuffer)], { type: mimeType });
      const file = new File([blob], "audio.ogg", { type: mimeType });

      return this.client.audio.transcriptions.create({
        file,
        model: env().GROQ_WHISPER_MODEL,
        language: "es",
        response_format: "text"
      });
    }, "Transcription");

    this.logger.debug("Transcription completed");
    // response_format: "text" returns a string directly
    return String(transcription).trim();
  }

  async chat(systemPrompt: string, userMessage: string): Promise<string> {
    this.logger.debug("Sending chat request to GROQ...");

    const completion = await this.withRetry(
      () =>
        this.client.chat.completions.create({
          model: env().GROQ_LLM_MODEL,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage }
          ],
          temperature: 0.7,
          max_tokens: 1024
        }),
      "Chat"
    );

    const response = completion.choices[0]?.message?.content || "";
    this.logger.debug("Chat response received");
    return response.trim();
  }

  async chatJSON<T>(systemPrompt: string, userMessage: string): Promise<T> {
    const response = await this.chat(systemPrompt, userMessage);

    // Extract JSON from response (may be wrapped in markdown code blocks)
    let jsonString = response;
    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonString = jsonMatch[1].trim();
    }

    try {
      return JSON.parse(jsonString) as T;
    } catch {
      this.logger.error("Failed to parse JSON response", { response });
      throw new Error(`Failed to parse AI response as JSON: ${response}`);
    }
  }
}
