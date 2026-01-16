# Dockerfile for integration testing
FROM node:18-alpine AS dependencies

# Install netcat for healthcheck and openssl for Prisma
RUN apk add --no-cache netcat-openbsd openssl

WORKDIR /app

# Copy only dependency files first for better caching
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies (cached unless package files change)
RUN npm ci

# Copy prisma schema and generate client (cached unless schema changes)
COPY prisma ./prisma
RUN npx prisma generate

# Build stage
FROM node:24-alpine

RUN apk add --no-cache netcat-openbsd openssl

WORKDIR /app

# Copy dependencies from previous stage
COPY --from=dependencies /app/package*.json ./
COPY --from=dependencies /app/prisma ./prisma
COPY src ./src

RUN npm ci

# Expose ports
EXPOSE 8042 8080

# Start server - run migrations first, then start
CMD ["sh", "-c", "npx prisma migrate deploy && node src/index.ts"]
