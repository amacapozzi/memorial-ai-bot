import { GroqClient, TranscriptionService, IntentService } from "@modules/ai";
import {
  GoogleAuthService,
  GoogleAuthRepository,
  GoogleCalendarService,
  createCalendarModule
} from "@modules/calendar";
import { CommitRepository, CommitService, createCommitModule } from "@modules/commits";
import { CryptoService } from "@modules/crypto";
import { DollarService } from "@modules/dollar";
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
import {
  ExpenseRepository,
  ExpenseService,
  ExpenseSummaryService,
  FinancialAdviceService
} from "@modules/expenses";
import { LinkingCodeRepository, LinkingCodeService, createLinkingModule } from "@modules/linking";
import { MapsService } from "@modules/maps";
import {
  MeliAuthRepository,
  MeliAuthService,
  MeliApiService,
  MeliTransferService,
  createMercadoLibreModule
} from "@modules/mercadolibre";
import { NewsService } from "@modules/news";
import { createNotificationModule } from "@modules/notification";
import { ProductSearchService } from "@modules/product-search";
import {
  ReminderService,
  ReminderRepository,
  SchedulerService,
  DigestService
} from "@modules/reminders";
import { SubscriptionRepository, SubscriptionService } from "@modules/subscription";
import {
  WhatsAppClient,
  SessionService,
  SessionRepository,
  QRHandler,
  MessageHandler
} from "@modules/whatsapp";
import { getPrismaClient } from "@shared/database";
import { env } from "@shared/env/env";
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
  const commitRepository = new CommitRepository(prisma);
  const meliAuthRepository = new MeliAuthRepository(prisma);
  const expenseRepository = new ExpenseRepository(prisma);

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

  // Product Search
  const productSearchService = new ProductSearchService();

  // Dollar / Crypto (no API key required)
  const dollarService = new DollarService();
  const cryptoService = new CryptoService();

  // News (optional — requires NEWS_API_KEY)
  const newsService = env().NEWS_API_KEY ? new NewsService(env().NEWS_API_KEY!) : undefined;

  // Maps (optional — requires ORS_API_KEY from openrouteservice.org)
  const mapsService = env().ORS_API_KEY ? new MapsService(env().ORS_API_KEY!) : undefined;

  // Expense Services
  const expenseService = new ExpenseService(expenseRepository);
  const financialAdviceService = new FinancialAdviceService(groqClient);

  // MercadoLibre Services (optional — only if MELI_APP_ID configured)
  const meliAuthService = env().MELI_APP_ID ? new MeliAuthService(meliAuthRepository) : undefined;
  const meliApiService = meliAuthService ? new MeliApiService(meliAuthService) : undefined;
  const meliTransferService = meliAuthService
    ? new MeliTransferService(meliAuthService)
    : undefined;

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
    userService,
    expenseService
  );

  // Email Sync Service
  const emailSyncService = new EmailSyncService(
    userRepository,
    emailProcessorService,
    gmailAuthService,
    subscriptionRepository
  );

  // Digest Service
  const digestService = new DigestService(reminderRepository, userRepository, whatsappClient);

  // Expense Summary Service (depends on whatsappClient, created before messageHandler)
  const expenseSummaryService = new ExpenseSummaryService(
    expenseService,
    expenseRepository,
    financialAdviceService,
    whatsappClient
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
    processedEmailRepository,
    productSearchService,
    meliAuthService,
    meliApiService,
    expenseService,
    financialAdviceService,
    expenseSummaryService,
    dollarService,
    cryptoService,
    newsService,
    mapsService,
    meliTransferService
  );

  // Scheduler
  const schedulerService = new SchedulerService(
    reminderService,
    whatsappClient,
    digestService,
    expenseSummaryService
  );

  // Commit Service
  const commitService = new CommitService(commitRepository);

  // Elysia modules
  const calendarModule = createCalendarModule(googleAuthService);
  const emailModule = createEmailModule(gmailAuthService, userService);
  const linkingModule = createLinkingModule(whatsappClient);
  const notificationModule = createNotificationModule(whatsappClient, prisma);
  const commitModule = createCommitModule(commitService, env().GITHUB_WEBHOOK_SECRET);
  const mercadoLibreModule = meliAuthService
    ? createMercadoLibreModule(meliAuthService, userService)
    : undefined;

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
    modules: [
      calendarModule,
      emailModule,
      linkingModule,
      notificationModule,
      commitModule,
      ...(mercadoLibreModule ? [mercadoLibreModule] : [])
    ],
    startServices,
    stopServices
  };
}
