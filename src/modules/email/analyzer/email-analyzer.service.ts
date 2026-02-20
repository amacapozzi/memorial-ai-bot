import type { GroqClient } from "@modules/ai/groq/groq.client";
import { createLogger } from "@shared/logger/logger";

import { buildEmailAnalysisPrompt } from "./email-analyzer.prompts";
import type { EmailMessage } from "../gmail/gmail.service";

export type EmailType =
  | "PURCHASE"
  | "DELIVERY"
  | "APPOINTMENT"
  | "MEETING"
  | "FLIGHT"
  | "LEGAL_HEARING"
  | "SECURITY"
  | "DEADLINE"
  | "COURSE"
  | "TASK"
  | "LEGAL_INFO"
  | "EVENT"
  | "OTHER";

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

export type ExpenseCategoryType =
  | "FOOD"
  | "TRANSPORT"
  | "SHOPPING"
  | "UTILITIES"
  | "ENTERTAINMENT"
  | "HEALTH"
  | "EDUCATION"
  | "TRAVEL"
  | "SERVICES"
  | "OTHER";

export interface ExpenseExtraction {
  merchant: string | null;
  amount: number | null;
  currency: string | null;
  category: ExpenseCategoryType;
}

export interface FlightInfo {
  airline: string;
  flightNumber: string;
  departure: { airport: string; dateTime: Date };
  arrival: { airport: string; dateTime: Date };
  confirmationCode: string | null;
}

export interface LegalHearingInfo {
  court: string;
  caseNumber: string | null;
  caseName: string | null;
  dateTime: Date;
  location: string | null;
  hearingType: string;
  judge: string | null;
  notes: string | null;
}

export interface SecurityInfo {
  alertType: string;
  service: string;
  details: string;
  ipOrLocation: string | null;
  actionRequired: string;
  urgency: "high" | "medium" | "low";
}

export interface DeadlineInfo {
  title: string;
  dueDate: Date;
  caseNumber: string | null;
  deadlineType: string;
  action: string;
  entity: string | null;
}

export interface CourseInfo {
  title: string;
  dateTime: Date;
  endDateTime: Date | null;
  organizer: string;
  location: string | null;
  meetingLink: string | null;
  instructor: string | null;
  topic: string | null;
}

export interface TaskInfo {
  title: string;
  dueDate: Date | null;
  assignedBy: string | null;
  priority: string | null;
  relatedCase: string | null;
  details: string | null;
}

export interface LegalInfoData {
  title: string;
  source: string;
  date: Date | null;
  caseNumber: string | null;
  summary: string;
  relevance: string | null;
  link: string | null;
}

export interface EventInfo {
  title: string;
  dateTime: Date;
  endDateTime: Date | null;
  organizer: string | null;
  location: string | null;
  meetingLink: string | null;
  description: string | null;
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
  legalHearingInfo: LegalHearingInfo | null;
  securityInfo: SecurityInfo | null;
  deadlineInfo: DeadlineInfo | null;
  courseInfo: CourseInfo | null;
  taskInfo: TaskInfo | null;
  legalInfoData: LegalInfoData | null;
  eventInfo: EventInfo | null;

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

  legalHearingInfo: {
    court: string;
    caseNumber: string | null;
    caseName: string | null;
    dateTime: string;
    location: string | null;
    hearingType: string;
    judge: string | null;
    notes: string | null;
  } | null;

  securityInfo: {
    alertType: string;
    service: string;
    details: string;
    ipOrLocation: string | null;
    actionRequired: string;
    urgency: "high" | "medium" | "low";
  } | null;

  deadlineInfo: {
    title: string;
    dueDate: string;
    caseNumber: string | null;
    deadlineType: string;
    action: string;
    entity: string | null;
  } | null;

  courseInfo: {
    title: string;
    dateTime: string;
    endDateTime: string | null;
    organizer: string;
    location: string | null;
    meetingLink: string | null;
    instructor: string | null;
    topic: string | null;
  } | null;

  taskInfo: {
    title: string;
    dueDate: string | null;
    assignedBy: string | null;
    priority: string | null;
    relatedCase: string | null;
    details: string | null;
  } | null;

  legalInfoData: {
    title: string;
    source: string;
    date: string | null;
    caseNumber: string | null;
    summary: string;
    relevance: string | null;
    link: string | null;
  } | null;

  eventInfo: {
    title: string;
    dateTime: string;
    endDateTime: string | null;
    organizer: string | null;
    location: string | null;
    meetingLink: string | null;
    description: string | null;
  } | null;

  shouldCreateReminder: boolean;
  suggestedReminderDateTime: string | null;
  suggestedReminderText: string | null;
}

export class EmailAnalyzerService {
  private readonly logger = createLogger("email-analyzer");

  constructor(private readonly groqClient: GroqClient) {}

  async extractExpenseData(emailContent: string): Promise<ExpenseExtraction | null> {
    const systemPrompt = `Eres un extractor de datos de compras. Dado el contenido de un email de compra/factura, extrae los datos del gasto.

Responde UNICAMENTE con JSON valido (sin markdown, sin explicaciones):
{
  "merchant": "nombre del comercio o tienda, o null si no se puede determinar",
  "amount": 1234.56 o null (numero decimal, sin simbolos de moneda),
  "currency": "ARS" | "USD" | "EUR" | "BRL" | null,
  "category": "FOOD" | "TRANSPORT" | "SHOPPING" | "UTILITIES" | "ENTERTAINMENT" | "HEALTH" | "EDUCATION" | "TRAVEL" | "SERVICES" | "OTHER"
}

Categorias:
- FOOD: restaurantes, delivery, supermercados, cafeterias
- TRANSPORT: uber, taxi, combustible, peajes, transporte publico
- SHOPPING: ropa, electronica, mercadolibre, amazon, tiendas online
- UTILITIES: luz, gas, agua, internet, telefono, servicios del hogar
- ENTERTAINMENT: streaming, juegos, cine, musica, netflix, spotify
- HEALTH: farmacia, medico, clinica, laboratorio
- EDUCATION: cursos, libros, plataformas educativas
- TRAVEL: hoteles, vuelos, airbnb, agencias de viaje
- SERVICES: suscripciones, software, servicios profesionales
- OTHER: cualquier otra cosa

Si el monto tiene separador de miles (ej: 1.234,56 o 1,234.56), interpretalo correctamente como numero decimal.
Si no es un email de compra/pago, responde con: {"merchant": null, "amount": null, "currency": null, "category": "OTHER"}`;

    try {
      const result = await this.groqClient.chatJSON<ExpenseExtraction>(systemPrompt, emailContent);
      if (result.amount === null && result.merchant === null) {
        return null;
      }
      return result;
    } catch (error) {
      this.logger.error(`Failed to extract expense data: ${error}`);
      return null;
    }
  }

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
        legalHearingInfo: null,
        securityInfo: null,
        deadlineInfo: null,
        courseInfo: null,
        taskInfo: null,
        legalInfoData: null,
        eventInfo: null,
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
      legalHearingInfo: null,
      securityInfo: null,
      deadlineInfo: null,
      courseInfo: null,
      taskInfo: null,
      legalInfoData: null,
      eventInfo: null,
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

    // Transform legal hearing info
    if (raw.legalHearingInfo) {
      result.legalHearingInfo = {
        court: raw.legalHearingInfo.court,
        caseNumber: raw.legalHearingInfo.caseNumber,
        caseName: raw.legalHearingInfo.caseName,
        dateTime: new Date(raw.legalHearingInfo.dateTime),
        location: raw.legalHearingInfo.location,
        hearingType: raw.legalHearingInfo.hearingType,
        judge: raw.legalHearingInfo.judge,
        notes: raw.legalHearingInfo.notes
      };
    }

    // Transform security info
    if (raw.securityInfo) {
      result.securityInfo = {
        alertType: raw.securityInfo.alertType,
        service: raw.securityInfo.service,
        details: raw.securityInfo.details,
        ipOrLocation: raw.securityInfo.ipOrLocation,
        actionRequired: raw.securityInfo.actionRequired,
        urgency: raw.securityInfo.urgency
      };
    }

    // Transform deadline info
    if (raw.deadlineInfo) {
      result.deadlineInfo = {
        title: raw.deadlineInfo.title,
        dueDate: new Date(raw.deadlineInfo.dueDate),
        caseNumber: raw.deadlineInfo.caseNumber,
        deadlineType: raw.deadlineInfo.deadlineType,
        action: raw.deadlineInfo.action,
        entity: raw.deadlineInfo.entity
      };
    }

    // Transform course info
    if (raw.courseInfo) {
      result.courseInfo = {
        title: raw.courseInfo.title,
        dateTime: new Date(raw.courseInfo.dateTime),
        endDateTime: raw.courseInfo.endDateTime ? new Date(raw.courseInfo.endDateTime) : null,
        organizer: raw.courseInfo.organizer,
        location: raw.courseInfo.location,
        meetingLink: raw.courseInfo.meetingLink,
        instructor: raw.courseInfo.instructor,
        topic: raw.courseInfo.topic
      };
    }

    // Transform task info
    if (raw.taskInfo) {
      result.taskInfo = {
        title: raw.taskInfo.title,
        dueDate: raw.taskInfo.dueDate ? new Date(raw.taskInfo.dueDate) : null,
        assignedBy: raw.taskInfo.assignedBy,
        priority: raw.taskInfo.priority,
        relatedCase: raw.taskInfo.relatedCase,
        details: raw.taskInfo.details
      };
    }

    // Transform legal info data
    if (raw.legalInfoData) {
      result.legalInfoData = {
        title: raw.legalInfoData.title,
        source: raw.legalInfoData.source,
        date: raw.legalInfoData.date ? new Date(raw.legalInfoData.date) : null,
        caseNumber: raw.legalInfoData.caseNumber,
        summary: raw.legalInfoData.summary,
        relevance: raw.legalInfoData.relevance,
        link: raw.legalInfoData.link
      };
    }

    // Transform event info
    if (raw.eventInfo) {
      result.eventInfo = {
        title: raw.eventInfo.title,
        dateTime: new Date(raw.eventInfo.dateTime),
        endDateTime: raw.eventInfo.endDateTime ? new Date(raw.eventInfo.endDateTime) : null,
        organizer: raw.eventInfo.organizer,
        location: raw.eventInfo.location,
        meetingLink: raw.eventInfo.meetingLink,
        description: raw.eventInfo.description
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
