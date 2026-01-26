import { GroqClient, TranscriptionService, IntentService } from "@modules/ai";
import {
  GoogleAuthService,
  GoogleAuthRepository,
  GoogleCalendarService,
  createCalendarModule
} from "@modules/calendar";
import { ReminderService, ReminderRepository, SchedulerService } from "@modules/reminders";
import {
  WhatsAppClient,
  SessionService,
  SessionRepository,
  QRHandler,
  MessageHandler
} from "@modules/whatsapp";
import { getPrismaClient } from "@shared/database";
import { createLogger } from "@shared/logger/logger";

export function buildApp() {
  const logger = createLogger("app");
  const prisma = getPrismaClient();

  // Repositories
  const sessionRepository = new SessionRepository(prisma);
  const googleAuthRepository = new GoogleAuthRepository(prisma);
  const reminderRepository = new ReminderRepository(prisma);

  // AI Services
  const groqClient = new GroqClient();
  const transcriptionService = new TranscriptionService(groqClient);
  const intentService = new IntentService(groqClient);

  // Google Services
  const googleAuthService = new GoogleAuthService(googleAuthRepository);
  const googleCalendarService = new GoogleCalendarService(googleAuthService);

  // Reminder Service
  const reminderService = new ReminderService(reminderRepository, googleCalendarService);

  // WhatsApp Services
  const sessionService = new SessionService(sessionRepository);
  const qrHandler = new QRHandler();
  const whatsappClient = new WhatsAppClient(sessionService, qrHandler);

  // Message Handler (connects all services)
  const messageHandler = new MessageHandler(
    whatsappClient,
    transcriptionService,
    intentService,
    reminderService
  );

  // Scheduler
  const schedulerService = new SchedulerService(reminderService, whatsappClient);

  // Elysia modules
  const calendarModule = createCalendarModule(googleAuthService);

  // Start function to initialize services
  const startServices = async () => {
    logger.info("Starting services...");

    // Connect WhatsApp
    await whatsappClient.connect();

    // Set up message handler
    whatsappClient.onMessage((message) => messageHandler.handle(message));

    // Start scheduler
    schedulerService.start();

    logger.info("All services started");
  };

  // Stop function for graceful shutdown
  const stopServices = async () => {
    logger.info("Stopping services...");
    schedulerService.stop();
    await whatsappClient.disconnect();
    await prisma.$disconnect();
    logger.info("All services stopped");
  };

  return {
    logger,
    modules: [calendarModule],
    startServices,
    stopServices
  };
}
