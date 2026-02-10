import type { GroqClient } from "@modules/ai/groq/groq.client";
import { createLogger } from "@shared/logger/logger";

import { EMAIL_REPLY_SYSTEM_PROMPT } from "./email-reply.prompts";

export interface OriginalEmail {
  subject: string;
  from: string;
  body: string;
  date: Date;
}

interface ComposedReply {
  subject: string;
  body: string;
}

export class EmailReplyService {
  private readonly logger = createLogger("email-reply");

  constructor(private readonly groqClient: GroqClient) {}

  async composeReply(params: {
    originalEmail: OriginalEmail;
    userInstruction: string;
    locale: string;
  }): Promise<ComposedReply> {
    this.logger.info(`Composing reply to "${params.originalEmail.subject?.substring(0, 50)}..."`);

    const userMessage = [
      `Email original:`,
      `De: ${params.originalEmail.from}`,
      `Asunto: ${params.originalEmail.subject}`,
      `Fecha: ${params.originalEmail.date.toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}`,
      ``,
      `Contenido:`,
      params.originalEmail.body.substring(0, 3000),
      ``,
      `---`,
      `Instruccion del usuario: ${params.userInstruction}`,
      `Idioma preferido: ${params.locale === "es" ? "español" : "english"}`
    ].join("\n");

    const response = await this.groqClient.chatJSON<ComposedReply>(
      EMAIL_REPLY_SYSTEM_PROMPT,
      userMessage
    );

    return {
      subject: response.subject,
      body: response.body
    };
  }
}
