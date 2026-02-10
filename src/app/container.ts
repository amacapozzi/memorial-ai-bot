import { GroqClient, TranscriptionService, IntentService } from "@modules/ai";
import {
  GoogleAuthService,
  GoogleAuthRepository,
  GoogleCalendarService,
  createCalendarModule
} from "@modules/calendar";
import {
  UserRepository,
  UserService,
  GmailAuthRepository,
  GmailAuthService,
  GmailService,
  EmailAnalyzerService,
  ProcessedEmailRepository,
  EmailProcessorService,
  EmailSyncService,
  EmailReplyService,
  createEmailModule
} from "@modules/email";
import { LinkingCodeRepository, LinkingCodeService, createLinkingModule } from "@modules/linking";
import { createNotificationModule } from "@modules/notification";
import { ReminderService, ReminderRepository, SchedulerService } from "@modules/reminders";
import { SubscriptionRepository, SubscriptionService } from "@modules/subscription";
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
  const userRepository = new UserRepository(prisma);
  const gmailAuthRepository = new GmailAuthRepository(prisma);
  const processedEmailRepository = new ProcessedEmailRepository(prisma);
  const linkingCodeRepository = new LinkingCodeRepository(prisma);
  const subscriptionRepository = new SubscriptionRepository(prisma);

  // AI Services
  const groqClient = new GroqClient();
  const transcriptionService = new TranscriptionService(groqClient);
  const intentService = new IntentService(groqClient);

  // Google Services
  const googleAuthService = new GoogleAuthService(googleAuthRepository);
  const googleCalendarService = new GoogleCalendarService(googleAuthService);

  // Reminder Service
  const reminderService = new ReminderService(reminderRepository, googleCalendarService);

  // User Service
  const userService = new UserService(userRepository);

  // Linking Service
  const linkingCodeService = new LinkingCodeService(linkingCodeRepository);

  // Subscription Service
  const subscriptionService = new SubscriptionService(subscriptionRepository);

  // Gmail Services
  const gmailAuthService = new GmailAuthService(gmailAuthRepository);
  const gmailService = new GmailService(gmailAuthService);
  const emailAnalyzerService = new EmailAnalyzerService(groqClient);
  const emailReplyService = new EmailReplyService(groqClient);

  // WhatsApp Services
  const sessionService = new SessionService(sessionRepository);
  const qrHandler = new QRHandler();
  const whatsappClient = new WhatsAppClient(sessionService, qrHandler);

  // Email Processor (needs whatsappClient)
  const emailProcessorService = new EmailProcessorService(
    gmailService,
    emailAnalyzerService,
    processedEmailRepository,
    reminderService,
    whatsappClient,
    userService
  );

  // Email Sync Service
  const emailSyncService = new EmailSyncService(
    userRepository,
    emailProcessorService,
    gmailAuthService,
    subscriptionRepository
  );

  // Message Handler (connects all services)
  const messageHandler = new MessageHandler(
    whatsappClient,
    transcriptionService,
    intentService,
    reminderService,
    userService,
    gmailAuthService,
    linkingCodeService,
    subscriptionService,
    emailReplyService,
    gmailService,
    processedEmailRepository
  );

  // Scheduler
  const schedulerService = new SchedulerService(reminderService, whatsappClient);

  // Elysia modules
  const calendarModule = createCalendarModule(googleAuthService);
  const emailModule = createEmailModule(gmailAuthService, userService);
  const linkingModule = createLinkingModule(whatsappClient);
  const notificationModule = createNotificationModule(whatsappClient, prisma);

  // Start function to initialize services
  const startServices = async () => {
    logger.info("Starting services...");

    // Connect WhatsApp
    await whatsappClient.connect();

    // Set up message handler
    whatsappClient.onMessage((message) => messageHandler.handle(message));

    // Start scheduler
    schedulerService.start();

    // Start email sync
    emailSyncService.start();

    logger.info("All services started");
  };

  // Stop function for graceful shutdown
  const stopServices = async () => {
    logger.info("Stopping services...");
    schedulerService.stop();
    emailSyncService.stop();
    await whatsappClient.disconnect();
    await prisma.$disconnect();
    logger.info("All services stopped");
  };

  return {
    logger,
    modules: [calendarModule, emailModule, linkingModule, notificationModule],
    startServices,
    stopServices
  };
}
