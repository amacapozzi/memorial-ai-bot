# syntax=docker/dockerfile:1

FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Build stage - generate Prisma client
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun --bun run prisma generate

# Production
FROM base AS production
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/src ./src
COPY --from=build /app/package.json ./
COPY --from=build /app/tsconfig.json ./
COPY --from=build /app/prisma.config.ts ./

EXPOSE 3000

CMD ["bun", "run", "src/app/index.ts"]
