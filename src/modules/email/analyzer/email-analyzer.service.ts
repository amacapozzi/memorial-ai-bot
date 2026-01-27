import type { GroqClient } from "@modules/ai/groq/groq.client";
import { createLogger } from "@shared/logger/logger";

import { buildEmailAnalysisPrompt } from "./email-analyzer.prompts";
import type { EmailMessage } from "../gmail/gmail.service";

export type EmailType = "PURCHASE" | "DELIVERY" | "APPOINTMENT" | "MEETING" | "FLIGHT" | "OTHER";

export interface DeliveryInfo {
  carrier: string;
  trackingNumber: string | null;
  estimatedDelivery: Date | null;
  itemDescription: string;
}

export interface AppointmentInfo {
  title: string;
  dateTime: Date;
  location: string | null;
  provider: string;
}

export interface MeetingInfo {
  title: string;
  dateTime: Date;
  organizer: string;
  location: string | null;
  meetingLink: string | null;
}

export interface PurchaseInfo {
  merchant: string;
  orderNumber: string | null;
  total: string | null;
  items: string[] | null;
}

export interface FlightInfo {
  airline: string;
  flightNumber: string;
  departure: { airport: string; dateTime: Date };
  arrival: { airport: string; dateTime: Date };
  confirmationCode: string | null;
}

export interface AnalyzedEmail {
  type: EmailType;
  confidence: number;
  summary: string;

  deliveryInfo: DeliveryInfo | null;
  appointmentInfo: AppointmentInfo | null;
  meetingInfo: MeetingInfo | null;
  purchaseInfo: PurchaseInfo | null;
  flightInfo: FlightInfo | null;

  shouldCreateReminder: boolean;
  suggestedReminderDateTime: Date | null;
  suggestedReminderText: string | null;
}

interface RawEmailAnalysis {
  type: EmailType;
  confidence: number;
  summary: string;

  deliveryInfo: {
    carrier: string;
    trackingNumber: string | null;
    estimatedDelivery: string | null;
    itemDescription: string;
  } | null;

  appointmentInfo: {
    title: string;
    dateTime: string;
    location: string | null;
    provider: string;
  } | null;

  meetingInfo: {
    title: string;
    dateTime: string;
    organizer: string;
    location: string | null;
    meetingLink: string | null;
  } | null;

  purchaseInfo: {
    merchant: string;
    orderNumber: string | null;
    total: string | null;
    items: string[] | null;
  } | null;

  flightInfo: {
    airline: string;
    flightNumber: string;
    departure: { airport: string; dateTime: string };
    arrival: { airport: string; dateTime: string };
    confirmationCode: string | null;
  } | null;

  shouldCreateReminder: boolean;
  suggestedReminderDateTime: string | null;
  suggestedReminderText: string | null;
}

export class EmailAnalyzerService {
  private readonly logger = createLogger("email-analyzer");

  constructor(private readonly groqClient: GroqClient) {}

  async analyzeEmail(email: EmailMessage): Promise<AnalyzedEmail> {
    this.logger.info(`Analyzing email: "${email.subject?.substring(0, 50)}..."`);

    const systemPrompt = buildEmailAnalysisPrompt();

    // Build the user message with email content
    const userMessage = this.buildEmailContent(email);

    try {
      const response = await this.groqClient.chatJSON<RawEmailAnalysis>(systemPrompt, userMessage);

      return this.transformResponse(response);
    } catch (error) {
      this.logger.error(`Failed to analyze email: ${error}`);

      // Return a safe default
      return {
        type: "OTHER",
        confidence: 0,
        summary: email.subject || "Unknown email",
        deliveryInfo: null,
        appointmentInfo: null,
        meetingInfo: null,
        purchaseInfo: null,
        flightInfo: null,
        shouldCreateReminder: false,
        suggestedReminderDateTime: null,
        suggestedReminderText: null
      };
    }
  }

  private buildEmailContent(email: EmailMessage): string {
    const parts = [
      `De: ${email.from}`,
      `Asunto: ${email.subject}`,
      `Fecha: ${email.date.toISOString()}`,
      "",
      "Contenido:",
      email.body.substring(0, 3000) // Limit body to 3000 chars
    ];

    return parts.join("\n");
  }

  private transformResponse(raw: RawEmailAnalysis): AnalyzedEmail {
    const result: AnalyzedEmail = {
      type: raw.type,
      confidence: raw.confidence,
      summary: raw.summary,
      deliveryInfo: null,
      appointmentInfo: null,
      meetingInfo: null,
      purchaseInfo: null,
      flightInfo: null,
      shouldCreateReminder: raw.shouldCreateReminder,
      suggestedReminderDateTime: raw.suggestedReminderDateTime
        ? new Date(raw.suggestedReminderDateTime)
        : null,
      suggestedReminderText: raw.suggestedReminderText
    };

    // Transform delivery info
    if (raw.deliveryInfo) {
      result.deliveryInfo = {
        carrier: raw.deliveryInfo.carrier,
        trackingNumber: raw.deliveryInfo.trackingNumber,
        estimatedDelivery: raw.deliveryInfo.estimatedDelivery
          ? new Date(raw.deliveryInfo.estimatedDelivery)
          : null,
        itemDescription: raw.deliveryInfo.itemDescription
      };
    }

    // Transform appointment info
    if (raw.appointmentInfo) {
      result.appointmentInfo = {
        title: raw.appointmentInfo.title,
        dateTime: new Date(raw.appointmentInfo.dateTime),
        location: raw.appointmentInfo.location,
        provider: raw.appointmentInfo.provider
      };
    }

    // Transform meeting info
    if (raw.meetingInfo) {
      result.meetingInfo = {
        title: raw.meetingInfo.title,
        dateTime: new Date(raw.meetingInfo.dateTime),
        organizer: raw.meetingInfo.organizer,
        location: raw.meetingInfo.location,
        meetingLink: raw.meetingInfo.meetingLink
      };
    }

    // Transform purchase info
    if (raw.purchaseInfo) {
      result.purchaseInfo = {
        merchant: raw.purchaseInfo.merchant,
        orderNumber: raw.purchaseInfo.orderNumber,
        total: raw.purchaseInfo.total,
        items: raw.purchaseInfo.items
      };
    }

    // Transform flight info
    if (raw.flightInfo) {
      result.flightInfo = {
        airline: raw.flightInfo.airline,
        flightNumber: raw.flightInfo.flightNumber,
        departure: {
          airport: raw.flightInfo.departure.airport,
          dateTime: new Date(raw.flightInfo.departure.dateTime)
        },
        arrival: {
          airport: raw.flightInfo.arrival.airport,
          dateTime: new Date(raw.flightInfo.arrival.dateTime)
        },
        confirmationCode: raw.flightInfo.confirmationCode
      };
    }

    // Validate reminder date is in the future
    if (result.suggestedReminderDateTime && result.suggestedReminderDateTime <= new Date()) {
      this.logger.warn("Suggested reminder date is in the past, disabling reminder");
      result.shouldCreateReminder = false;
      result.suggestedReminderDateTime = null;
      result.suggestedReminderText = null;
    }

    return result;
  }
}
