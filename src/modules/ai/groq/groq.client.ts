import Groq from "groq-sdk";

import { env } from "@shared/env/env";
import { createLogger } from "@shared/logger/logger";

const MAX_RETRIES = 2;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 5000;
const REQUEST_TIMEOUT_MS = 30_000;

export class GroqClient {
  private readonly client: Groq;
  private readonly logger = createLogger("groq");

  constructor() {
    this.client = new Groq({
      apiKey: env().GROQ_API_KEY,
      timeout: REQUEST_TIMEOUT_MS
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

        const delay = this.getRetryDelay(attempt);
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

    // Never retry rate limits — throw immediately so user gets instant feedback
    if (status === 429) {
      return false;
    }

    // 500/502/503/504 = server errors, worth retrying
    if (status === 500 || status === 502 || status === 503 || status === 504) {
      return true;
    }
    // Network errors (no status code)
    if (err.code === "ECONNRESET" || err.code === "ETIMEDOUT") {
      return true;
    }
    return false;
  }

  private getRetryDelay(attempt: number): number {
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
