# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Memorial AI Bot is a WhatsApp bot that processes voice/text messages to create reminders and calendar events. Built with Bun + Elysia following modular architecture.

## Commands

```bash
bun dev          # Start dev server (watch mode)
bun lint         # Run ESLint
bun lint:fix     # Fix lint issues
bun typecheck    # TypeScript type checking
```

### Prisma

```bash
bun --bun run prisma generate    # Generate Prisma client
bun --bun run prisma migrate dev # Run migrations
bun --bun run prisma studio      # Open Prisma Studio
```

Prisma schema is at `src/prisma/schema.prisma`, generated client at `src/prisma/generated/`.

## Architecture

### Path Aliases

- `@app/*` → `src/app/*`
- `@shared/*` → `src/shared/*`
- `@modules/*` → `src/modules/*`
- `@prisma-module/*` → `src/prisma/*`

### Module Structure

Each module in `src/modules/` is self-contained with its own repository, service, and handler layers. Modules export through barrel `index.ts` files.

**Modules:**

- `whatsapp/` - WhatsApp client (Baileys), session management, QR handling, message processing
- `ai/` - GROQ client for Whisper transcription and LLM intent parsing
- `calendar/` - Google OAuth and Calendar API integration
- `reminders/` - Reminder CRUD and scheduler service

### Composition Root

`src/app/container.ts` wires all dependencies manually (no DI container). The `buildApp()` function creates repositories → services → handlers in order.

### Request Flow

```
WhatsApp message → MessageHandler → TranscriptionService (audio) → IntentService (LLM) → ReminderService → GoogleCalendarService
```

### Key Rules

- `app/` only wires things together
- `modules/` must not depend on `app/`
- Business logic never depends on HTTP or framework code
- Environment validation uses Zod (`src/shared/env/schema.ts`)

## Environment Variables

Required in `.env`:

- `DATABASE_URL` - PostgreSQL connection string
- `GROQ_API_KEY` - GROQ API key for Whisper/LLM
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` - Google OAuth credentials
- `ALLOWED_PHONE_NUMBER` - (optional) Restrict to single WhatsApp number
