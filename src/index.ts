import dotenv from "dotenv";
import { AuthService } from "./services/auth.service";
import { TCPServer } from "./tcp/server";

dotenv.config();

const TCP_PORT = parseInt(process.env.TCP_PORT || "8042", 10);
const DATABASE_URL = process.env.DATABASE_URL || "file:./prisma/dev.db";

console.log("Homed Server Google - Starting...");
console.log(`Database: ${DATABASE_URL}`);

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
  console.log(`Client ${client.getUniqueId()} authenticated as user ${userId}`);
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

// Graceful shutdown
const shutdown = async () => {
  console.log("Shutting down...");
  await tcpServer.stop();
  await authService.disconnect();
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

export {};
