import { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcrypt";
import dotenv from "dotenv";
import express from "express";
import * as fs from "fs";
import oauthRoutes from "./routes/oauth.routes";
import smarthomeRoutes from "./routes/smarthome.routes";
import { setTCPServer } from "./routes/smarthome.routes";
import { AuthService } from "./services/auth.service";
import { TCPServer } from "./tcp/server";

dotenv.config();

const TCP_PORT = parseInt(process.env.TCP_PORT || "8042", 10);
const HTTP_PORT = parseInt(process.env.PORT || "8080", 10);
const DATABASE_URL = process.env.DATABASE_URL || "file:./prisma/dev.db";

console.log("Homed Server Google - Starting...");
console.log(`Database: ${DATABASE_URL}`);

// Database initialization
async function initializeDatabase() {
  const prisma = new PrismaClient();

  try {
    // Check if database is initialized by trying to query users
    const userCount = await prisma.user.count();

    if (userCount === 0) {
      console.log("Database empty, creating initial user...");

      const username =
        process.env.TEST_USERNAME || process.env.INITIAL_USERNAME || "admin";
      const password =
        process.env.TEST_PASSWORD || process.env.INITIAL_PASSWORD || "changeme";
      const clientToken =
        process.env.NODE_ENV === "test"
          ? "13e19d111d4b44f52e62f0cdf8b0980865037b3f1ec0b954e79c1d9290375b6e"
          : // eslint-disable-next-line @typescript-eslint/no-require-imports
            require("crypto").randomBytes(32).toString("hex");

      await prisma.user.create({
        data: {
          username,
          passwordHash: await bcrypt.hash(password, 10),
          clientToken,
        },
      });

      console.log(`✅ Initial user created: ${username}`);
      console.log(`   Client Token: ${clientToken}`);

      // TODO: Figure out why this is needed for tests to pass
      if (process.env.NODE_ENV === "test") {
        // Write test configuration file
        const confPath = "tests/integration/homed-cloud.conf";
        const confTemplate = fs.existsSync(
          "tests/integration/homed-cloud.conf.template"
        )
          ? fs.readFileSync(
              "tests/integration/homed-cloud.conf.template",
              "utf8"
            )
          : `cloud:\n  token: ${clientToken}\n  username: ${username}`;

        fs.writeFileSync(
          confPath,
          confTemplate.replace("${CLIENT_TOKEN}", clientToken)
        );
        console.log(`✅ Test configuration written to ${confPath}`);
      }
    }
  } catch (error) {
    console.warn("Database initialization check failed:", error);
  } finally {
    await prisma.$disconnect();
  }
}

// Initialize database before starting servers
(async () => {
  await initializeDatabase();

  // Initialize auth service
  const authService = new AuthService();

  // Start TCP server
  const tcpServer = new TCPServer(TCP_PORT);

  tcpServer.on("listening", (port: number) => {
    console.log(`TCP Server listening on port ${port}`);
  });

  tcpServer.on("client-handshake", (client: any) => {
    console.log(
      `Client ${client.getUniqueId()} completed handshake, connection established`
    );
  });

  tcpServer.on(
    "client-authorization",
    async (client: any, auth: { uniqueId: string; token: string }) => {
      console.log(`Client ${auth.uniqueId} attempting authorization...`);

      // Validate token
      const user = await authService.validateClientToken(auth.token);

      if (user) {
        // Mark client as authenticated
        client.setAuthenticated(user.id);
        console.log(
          `Client ${auth.uniqueId} authorization successful for user ${user.username}`
        );
      } else {
        console.error(
          `Client ${auth.uniqueId} authorization failed: invalid token`
        );
        client.close();
      }
    }
  );

  tcpServer.on("client-authenticated", (client: any, userId: string) => {
    console.log(
      `Client ${client.getUniqueId()} authenticated as user ${userId}`
    );
  });

  tcpServer.on("client-message", (client: any, message: any) => {
    console.log(
      `Received message from client ${client.getUniqueId()}: ${JSON.stringify(message)}`
    );

    // Log different message types for test verification
    // Messages are received from homed-service-cloud which subscribes to MQTT
    if (message.topic) {
      const topic = message.topic;
      if (topic.includes("/status/")) {
        console.log(`Service status update: ${topic}`);
      } else if (topic.includes("/expose/")) {
        console.log(`Device expose update: ${topic}`);
      } else if (topic.includes("/device/")) {
        const deviceId = topic.split("/").pop();
        console.log(`Device update for: ${deviceId}`);
      } else if (topic.includes("/fd/")) {
        const deviceId = topic.split("/").pop();
        console.log(`Device state update for: ${deviceId}`);
      }
    }
  });

  tcpServer.on("error", (error: Error) => {
    console.error("TCP Server error:", error);
  });

  tcpServer
    .start()
    .then(() => {
      console.log("TCP Server started successfully");
    })
    .catch(error => {
      console.error("Failed to start TCP Server:", error);
      process.exit(1);
    });

  // Start HTTP server for test endpoints (when NODE_ENV=test)
  if (process.env.NODE_ENV === "test") {
    const app = express();
    app.use(express.json());

    // Set the TCP server for smarthome routes
    setTCPServer(tcpServer);

    // Register OAuth and fulfillment routes
    app.use("/oauth", oauthRoutes);
    app.use(smarthomeRoutes);

    // Test endpoint to get connected clients
    app.get("/test/clients", (_req, res) => {
      const clients = tcpServer.getClientIds();
      res.json({
        count: tcpServer.getClientCount(),
        clients: clients,
      });
    });

    // Test endpoint to check server status
    app.get("/test/status", (_req, res) => {
      res.json({
        status: "ok",
        clientCount: tcpServer.getClientCount(),
      });
    });

    app.listen(HTTP_PORT, () => {
      console.log(`✅ HTTP Server listening on port ${HTTP_PORT}`);
      console.log(`   OAuth: http://localhost:${HTTP_PORT}/oauth/authorize`);
      console.log(`   Fulfillment: http://localhost:${HTTP_PORT}/fulfillment`);
      console.log(`   Test API: http://localhost:${HTTP_PORT}/test/*`);
    });
  }

  // Graceful shutdown
  const shutdown = async () => {
    console.log("Shutting down...");
    await tcpServer.stop();
    await authService.disconnect();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
})();

export {};
