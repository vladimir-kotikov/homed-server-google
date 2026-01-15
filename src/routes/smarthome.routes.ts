import { Router } from "express";
import { SmartHomeController } from "../controllers/smarthome.controller";
import { authenticateToken } from "../middleware/auth.middleware";
import { DeviceService } from "../services/device.service";
import { TokenService } from "../services/token.service";
import { TCPServer } from "../tcp/server";

// These will be injected from index.ts
let tcpServer: TCPServer;

export function setTCPServer(server: TCPServer): void {
  tcpServer = server;
}

const router = Router();

// POST /fulfillment - Main Smart Home fulfillment endpoint
router.post("/fulfillment", authenticateToken, (req, res) => {
  const deviceService = new DeviceService(tcpServer);
  const tokenService = new TokenService();
  const controller = new SmartHomeController(deviceService, tokenService);

  controller.handleFulfillment(req, res);
});

export default router;
