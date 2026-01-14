# Dockerfile for integration testing
FROM node:18-alpine

# Install netcat for healthcheck and openssl for Prisma
RUN apk add --no-cache netcat-openbsd openssl

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY src ./src
COPY prisma ./prisma

# Generate Prisma client
RUN npx prisma generate

# Build TypeScript
RUN npm run build

# Expose ports
EXPOSE 8042 8080

# Start server
CMD ["node", "dist/index.js"]
