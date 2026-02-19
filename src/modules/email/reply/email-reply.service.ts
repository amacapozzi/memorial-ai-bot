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

const EMAIL_EXTRACT_SYSTEM_PROMPT = `Eres un asistente que extrae información específica de emails.
El usuario quiere que encuentres y extraigas un dato puntual del email proporcionado.
Si encontras la información pedida, respondela de forma directa y concisa (solo el dato, sin rodeos).
Si no encontras la información, decí claramente que no está en el email.
Responde en español rioplatense.`;

export class EmailReplyService {
  private readonly logger = createLogger("email-reply");

  constructor(private readonly groqClient: GroqClient) {}

  async extractInfo(params: {
    emailBody: string;
    from: string;
    subject: string;
    date: Date;
    extractionQuery: string;
  }): Promise<string> {
    this.logger.info(
      `Extracting "${params.extractionQuery}" from "${params.subject?.substring(0, 50)}"`
    );

    const userMessage = [
      `De: ${params.from}`,
      `Asunto: ${params.subject}`,
      `Fecha: ${params.date.toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}`,
      ``,
      `Contenido del email:`,
      params.emailBody.substring(0, 5000),
      ``,
      `---`,
      `Dato que necesito encontrar: ${params.extractionQuery}`
    ].join("\n");

    return this.groqClient.chat(EMAIL_EXTRACT_SYSTEM_PROMPT, userMessage);
  }

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
