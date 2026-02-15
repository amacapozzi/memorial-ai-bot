import Groq from "groq-sdk";

import { env } from "@shared/env/env";
import { createLogger } from "@shared/logger/logger";

const MAX_RETRIES = 2;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 5000;
const REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_COOLDOWN_MS = 60_000;

const logger = createLogger("groq");

class ModelPool {
  private readonly models: string[];
  private readonly cooldowns = new Map<string, number>();

  constructor(models: string[]) {
    // Deduplicate while preserving order
    this.models = [...new Set(models)];
  }

  getAvailable(): string | null {
    const now = Date.now();
    for (const model of this.models) {
      const expiresAt = this.cooldowns.get(model);
      if (expiresAt === undefined || now >= expiresAt) {
        this.cooldowns.delete(model);
        return model;
      }
    }
    return null;
  }

  getNextCooldownMs(): number {
    const now = Date.now();
    let earliest = Infinity;
    for (const expiresAt of this.cooldowns.values()) {
      earliest = Math.min(earliest, expiresAt - now);
    }
    return Math.max(0, earliest);
  }

  markRateLimited(model: string, retryAfterMs?: number): void {
    const cooldown = retryAfterMs ?? DEFAULT_COOLDOWN_MS;
    this.cooldowns.set(model, Date.now() + cooldown);
    logger.warn(`Model ${model} rate limited, cooldown ${Math.round(cooldown / 1000)}s`);
  }
}

function buildModelList(singleEnvVar: string, listEnvVar: string): string[] {
  const listRaw = listEnvVar.trim();
  const models = listRaw
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);

  // If the single-model env var was customized and isn't already first, prepend it
  const single = singleEnvVar.trim();
  if (single && models[0] !== single) {
    return [single, ...models.filter((m) => m !== single)];
  }

  return models;
}

function parseRetryAfterMs(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;

  const err = error as Record<string, unknown>;

  // Try to extract from error headers
  const headers = err.headers as Record<string, string> | undefined;
  if (headers) {
    const retryAfter = headers["retry-after"];
    if (retryAfter) {
      const seconds = Number(retryAfter);
      if (!Number.isNaN(seconds)) return seconds * 1000;
    }
  }

  // Try to parse from error message (Groq often includes "Please try again in Xm Ys")
  const message = String(err.message ?? err.error ?? "");
  const match = message.match(/try again in (\d+)m\s*(\d+(?:\.\d+)?)s/i);
  if (match) {
    const minutes = Number(match[1]);
    const seconds = Number(match[2]);
    return (minutes * 60 + seconds) * 1000;
  }

  const secondsMatch = message.match(/try again in (\d+(?:\.\d+)?)s/i);
  if (secondsMatch) {
    return Number(secondsMatch[1]) * 1000;
  }

  return undefined;
}

export class GroqClient {
  private readonly client: Groq;
  private readonly logger = createLogger("groq");
  private readonly llmPool: ModelPool;
  private readonly whisperPool: ModelPool;

  constructor() {
    this.client = new Groq({
      apiKey: env().GROQ_API_KEY,
      timeout: REQUEST_TIMEOUT_MS
    });

    this.llmPool = new ModelPool(buildModelList(env().GROQ_LLM_MODEL, env().GROQ_LLM_MODELS));
    this.whisperPool = new ModelPool(
      buildModelList(env().GROQ_WHISPER_MODEL, env().GROQ_WHISPER_MODELS)
    );
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

    // Never retry rate limits — handled by model rotation instead
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

  private isRateLimit(error: unknown): boolean {
    if (typeof error !== "object" || error === null) return false;
    return (error as Record<string, unknown>).status === 429;
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

    const transcription = await this.withModelRotation(
      this.whisperPool,
      (model) =>
        this.withRetry(async () => {
          const blob = new Blob([new Uint8Array(audioBuffer)], { type: mimeType });
          const file = new File([blob], "audio.ogg", { type: mimeType });

          return this.client.audio.transcriptions.create({
            file,
            model,
            language: "es",
            response_format: "text"
          });
        }, `Transcription[${model}]`),
      "Transcription"
    );

    this.logger.debug("Transcription completed");
    return String(transcription).trim();
  }

  async chat(systemPrompt: string, userMessage: string): Promise<string> {
    this.logger.debug("Sending chat request to GROQ...");

    const completion = await this.withModelRotation(
      this.llmPool,
      (model) =>
        this.withRetry(
          () =>
            this.client.chat.completions.create({
              model,
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userMessage }
              ],
              temperature: 0.7,
              max_tokens: 1024
            }),
          `Chat[${model}]`
        ),
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

  private async withModelRotation<T>(
    pool: ModelPool,
    operation: (model: string) => Promise<T>,
    label: string
  ): Promise<T> {
    while (true) {
      const model = pool.getAvailable();
      if (!model) {
        const waitSec = Math.round(pool.getNextCooldownMs() / 1000);
        throw new Error(`All ${label} models are rate limited. Next available in ~${waitSec}s`);
      }

      try {
        const result = await operation(model);
        return result;
      } catch (error) {
        if (this.isRateLimit(error)) {
          const retryAfterMs = parseRetryAfterMs(error);
          pool.markRateLimited(model, retryAfterMs);
          this.logger.info(`${label}: model ${model} rate limited, rotating to next model`);
          continue;
        }
        throw error;
      }
    }
  }
}
