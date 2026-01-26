import { google, type calendar_v3 } from "googleapis";

import { createLogger } from "@shared/logger/logger";

import type { GoogleAuthService } from "./google-auth.service";

export interface CreateEventInput {
  summary: string;
  description?: string;
  startTime: Date;
  endTime?: Date;
}

export class GoogleCalendarService {
  private readonly logger = createLogger("google-calendar");

  constructor(private readonly authService: GoogleAuthService) {}

  private async getCalendar(): Promise<calendar_v3.Calendar> {
    const auth = await this.authService.getAuthClient();
    return google.calendar({ version: "v3", auth });
  }

  async createEvent(input: CreateEventInput): Promise<string> {
    this.logger.info(`Creating calendar event: ${input.summary}`);

    const calendar = await this.getCalendar();

    // Default duration is 30 minutes
    const endTime = input.endTime || new Date(input.startTime.getTime() + 30 * 60 * 1000);

    const event = await calendar.events.insert({
      calendarId: "primary",
      requestBody: {
        summary: input.summary,
        description: input.description || "Recordatorio creado por Memorial AI Bot",
        start: {
          dateTime: input.startTime.toISOString(),
          timeZone: "America/Argentina/Buenos_Aires"
        },
        end: {
          dateTime: endTime.toISOString(),
          timeZone: "America/Argentina/Buenos_Aires"
        },
        reminders: {
          useDefault: false,
          overrides: [
            { method: "popup", minutes: 10 },
            { method: "popup", minutes: 0 }
          ]
        }
      }
    });

    const eventId = event.data.id;
    if (!eventId) {
      throw new Error("Failed to create calendar event");
    }

    this.logger.info(`Calendar event created: ${eventId}`);
    return eventId;
  }

  async deleteEvent(eventId: string): Promise<void> {
    this.logger.info(`Deleting calendar event: ${eventId}`);

    const calendar = await this.getCalendar();

    await calendar.events.delete({
      calendarId: "primary",
      eventId
    });

    this.logger.info("Calendar event deleted");
  }

  async updateEvent(
    eventId: string,
    updates: { startTime?: Date; endTime?: Date; summary?: string }
  ): Promise<void> {
    this.logger.info(`Updating calendar event: ${eventId}`);

    const calendar = await this.getCalendar();

    const requestBody: calendar_v3.Schema$Event = {};

    if (updates.startTime) {
      const endTime = updates.endTime || new Date(updates.startTime.getTime() + 30 * 60 * 1000);
      requestBody.start = {
        dateTime: updates.startTime.toISOString(),
        timeZone: "America/Argentina/Buenos_Aires"
      };
      requestBody.end = {
        dateTime: endTime.toISOString(),
        timeZone: "America/Argentina/Buenos_Aires"
      };
    }

    if (updates.summary) {
      requestBody.summary = updates.summary;
    }

    await calendar.events.patch({
      calendarId: "primary",
      eventId,
      requestBody
    });

    this.logger.info("Calendar event updated");
  }

  async checkAvailability(startTime: Date, endTime: Date): Promise<boolean> {
    this.logger.debug(`Checking availability from ${startTime} to ${endTime}`);

    const calendar = await this.getCalendar();

    const events = await calendar.events.list({
      calendarId: "primary",
      timeMin: startTime.toISOString(),
      timeMax: endTime.toISOString(),
      singleEvents: true
    });

    const isFree = !events.data.items || events.data.items.length === 0;
    this.logger.debug(`Time slot is ${isFree ? "available" : "busy"}`);
    return isFree;
  }

  async getUpcomingEvents(maxResults: number = 10): Promise<calendar_v3.Schema$Event[]> {
    const calendar = await this.getCalendar();

    const events = await calendar.events.list({
      calendarId: "primary",
      timeMin: new Date().toISOString(),
      maxResults,
      singleEvents: true,
      orderBy: "startTime"
    });

    return events.data.items || [];
  }
}
