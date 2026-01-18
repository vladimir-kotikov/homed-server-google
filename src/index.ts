import * as bcrypt from "bcrypt";
import * as crypto from "crypto";
import express from "express";
import * as fs from "fs";
import { type AppConfig, loadConfig } from "./config/config.ts";
import { closeDatabase, initializeDatabase } from "./db/index.ts";
import { UserRepository } from "./db/repositories/index.ts";
import oauthRoutes from "./routes/oauth.routes.ts";
import smarthomeRoutes, { setTCPServer } from "./routes/smarthome.routes.ts";
import { AuthService } from "./services/auth.service.ts";
import { TCPServer } from "./tcp/server.ts";

let appConfig: AppConfig;
try {
  appConfig = loadConfig();
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}

const { isProd, isTest, allowAutoSeed, databaseUrl, tcpPort, httpPort } =
  appConfig;

console.log("Homed Server Google - Starting...");
console.log(`Database: ${databaseUrl}`);

// Database initialization
async function initDb() {
  // Initialize database connection
  initializeDatabase(databaseUrl);
  const userRepository = new UserRepository();

  try {
    // Check if database is initialized by checking if any users exist
    const hasUsers = await userRepository.exists();

    if (!hasUsers) {
      if (!allowAutoSeed) {
        console.error(
          "Database is empty and ALLOW_DEV_AUTO_SEED is disabled. Seed the database manually or set ALLOW_DEV_AUTO_SEED=true with ADMIN_USERNAME and ADMIN_PASSWORD."
        );
        process.exit(1);
      }

      const username =
        process.env.TEST_USERNAME ||
        process.env.ADMIN_USERNAME ||
        process.env.INITIAL_USERNAME ||
        "admin";
      const password =
        process.env.TEST_PASSWORD ||
        process.env.ADMIN_PASSWORD ||
        process.env.INITIAL_PASSWORD ||
        "password";

      if (
        isProd &&
        (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD)
      ) {
        console.error(
          "Production startup requires ADMIN_USERNAME and ADMIN_PASSWORD to seed the initial user or a pre-seeded database."
        );
        process.exit(1);
      }

      const clientToken = isTest
        ? "13e19d111d4b44f52e62f0cdf8b0980865037b3f1ec0b954e79c1d9290375b6e"
        : crypto.randomBytes(32).toString("hex");

      await userRepository.create(
        username,
        await bcrypt.hash(password, 10),
        clientToken
      );

      console.log(`✅ Initial user created: ${username}`);
      if (isTest) {
        console.log(`   Client Token: ${clientToken}`);
      }

      // TODO: Figure out why this is needed for tests to pass
      if (isTest) {
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
  }
}

// Initialize database before starting servers
(async () => {
  await initDb();

  // Initialize auth service
  const authService = new AuthService();

  // Start TCP server
  const tcpServer = new TCPServer(tcpPort);

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
    const userId = client.getUserId();
    console.log(
      `📩 Received message from client ${client.getUniqueId()} (user: ${userId}):`
    );
    console.log(`   Topic: ${message.topic || "(no topic)"}`);
    console.log(`   Action: ${message.action || "(no action)"}`);
    console.log(
      `   Message: ${JSON.stringify(message.message || {}).substring(0, 200)}`
    );

    // Log different message types for test verification
    // Messages are received from homed-service-cloud which subscribes to MQTT
    if (message.topic) {
      const topic = message.topic;

      if (topic.startsWith("status/")) {
        console.log(`Service status update: ${topic}`);
      } else if (topic.startsWith("expose/")) {
        console.log(`Device expose update: ${topic}`);
      } else if (topic.startsWith("device/")) {
        console.log(`Device update: ${topic}`);
      } else if (topic.startsWith("fd/")) {
        console.log(`Device state update: ${topic}`);
      }
    }
  });

  tcpServer.on("error", (error: Error) => {
    console.error("TCP Server error:", error);
  });

  tcpServer.on("client-error", (client: any, error: Error) => {
    console.error(`Client ${client.getUniqueId()} error:`, error.message);
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

  // Start HTTP server (always on; test-only routes are scoped)
  const app = express();
  app.use(express.json());

  // Set the TCP server for smarthome routes
  setTCPServer(tcpServer);

  // Register OAuth and fulfillment routes
  app.use("/oauth", oauthRoutes);
  app.use(smarthomeRoutes);

  if (isTest) {
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
  }

  app.listen(httpPort, () => {
    console.log(`✅ HTTP Server listening on port ${httpPort}`);
    console.log(`   OAuth: http://localhost:${httpPort}/oauth/authorize`);
    console.log(`   Fulfillment: http://localhost:${httpPort}/fulfillment`);
    if (isTest) {
      console.log(`   Test API: http://localhost:${httpPort}/test/*`);
    }
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log("Shutting down...");
    await tcpServer.stop();
    await authService.disconnect();
    closeDatabase();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
})();

export {};
