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

  // Google Calendar OAuth2
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_REDIRECT_URI: z.string().url().default("http://localhost:3000/auth/google/callback"),

  // Security: only process messages from this number (optional)
  ALLOWED_PHONE_NUMBER: z.string().optional()
});

export type Env = z.infer<typeof envSchema>;
