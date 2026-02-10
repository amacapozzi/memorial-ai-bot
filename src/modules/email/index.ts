// User
export { UserRepository, UserService } from "./user";

// Gmail
export { GmailAuthRepository, GmailAuthService, GmailService, type EmailMessage } from "./gmail";

// Analyzer
export {
  EmailAnalyzerService,
  type AnalyzedEmail,
  type EmailType,
  type DeliveryInfo,
  type AppointmentInfo,
  type MeetingInfo,
  type PurchaseInfo,
  type FlightInfo,
  type SecurityInfo
} from "./analyzer";

// Processor
export { ProcessedEmailRepository, EmailProcessorService } from "./processor";

// Sync
export { EmailSyncService } from "./sync";

// Reply
export { EmailReplyService, type OriginalEmail } from "./reply";

// Module
export { createEmailModule } from "./email.module";
