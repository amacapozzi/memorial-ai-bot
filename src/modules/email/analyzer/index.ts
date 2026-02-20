export {
  EmailAnalyzerService,
  type AnalyzedEmail,
  type EmailType,
  type DeliveryInfo,
  type AppointmentInfo,
  type MeetingInfo,
  type PurchaseInfo,
  type FlightInfo,
  type SecurityInfo,
  type ExpenseExtraction,
  type ExpenseCategoryType
} from "./email-analyzer.service";
export { buildEmailAnalysisPrompt } from "./email-analyzer.prompts";
