import Groq from "groq-sdk";

import { env } from "@shared/env/env";
import { createLogger } from "@shared/logger/logger";

export class GroqClient {
  private readonly client: Groq;
  private readonly logger = createLogger("groq");

  constructor() {
    this.client = new Groq({
      apiKey: env().GROQ_API_KEY
    });
  }

  async transcribeAudio(audioBuffer: Buffer, mimeType: string): Promise<string> {
    this.logger.debug("Transcribing audio with Whisper...");

    // Convert buffer to File-like object for the API
    const blob = new Blob([new Uint8Array(audioBuffer)], { type: mimeType });
    const file = new File([blob], "audio.ogg", { type: mimeType });

    const transcription = await this.client.audio.transcriptions.create({
      file,
      model: env().GROQ_WHISPER_MODEL,
      language: "es",
      response_format: "text"
    });

    this.logger.debug("Transcription completed");
    // response_format: "text" returns a string directly
    return String(transcription).trim();
  }

  async chat(systemPrompt: string, userMessage: string): Promise<string> {
    this.logger.debug("Sending chat request to GROQ...");

    const completion = await this.client.chat.completions.create({
      model: env().GROQ_LLM_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage }
      ],
      temperature: 0.7,
      max_tokens: 1024
    });

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
