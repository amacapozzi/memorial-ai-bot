import { z } from "zod";

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),

  // Database
  DATABASE_URL: z.string().url(),

  // GROQ AI
  GROQ_API_KEY: z.string().min(1),
  GROQ_WHISPER_MODEL: z.string().default("whisper-large-v3"),
  GROQ_LLM_MODEL: z.string().default("llama-3.3-70b-versatile"),
  // Comma-separated list of models for automatic rotation on rate limits
  GROQ_LLM_MODELS: z
    .string()
    .default(
      "llama-3.3-70b-versatile,meta-llama/llama-4-scout-17b-16e-instruct,llama-3.1-8b-instant,qwen/qwen3-32b,openai/gpt-oss-120b"
    ),
  GROQ_WHISPER_MODELS: z.string().default("whisper-large-v3,whisper-large-v3-turbo"),

  // Google Calendar OAuth2
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_REDIRECT_URI: z.string().url().default("http://localhost:3000/auth/google/callback"),

  // Security: only process messages from this number (optional)
  ALLOWED_PHONE_NUMBER: z.string().optional(),

  // Gmail integration
  GMAIL_REDIRECT_URI: z.string().url().default("http://localhost:3000/auth/gmail/callback"),
  EMAIL_SYNC_INTERVAL_MS: z.coerce.number().default(120000), // 2 minutes

  // Public host URL for OAuth callbacks
  HOST_URL: z.string().url().default("http://localhost:3000"),

  // Shared secret for webhook endpoints (website → bot)
  WEBHOOK_SECRET: z.string().min(1).default("change-me"),

  // GitHub webhook secret (for push event tracking)
  GITHUB_WEBHOOK_SECRET: z.string().min(1).optional(),

  // SerpAPI key for Google Shopping search (optional)
  SERPAPI_API_KEY: z.string().min(1).optional(),

  // MercadoLibre OAuth (optional)
  MELI_APP_ID: z.string().min(1).optional(),
  MELI_CLIENT_SECRET: z.string().min(1).optional(),
  MELI_REDIRECT_URI: z.string().url().default("http://localhost:3000/auth/mercadolibre/callback"),

  // NewsAPI.org (optional)
  NEWS_API_KEY: z.string().min(1).optional(),

  // OpenRouteService Directions API (optional) — free at openrouteservice.org
  ORS_API_KEY: z.string().min(1).optional()
});

export type Env = z.infer<typeof envSchema>;
