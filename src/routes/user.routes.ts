import { Router } from "express";
import { UserController } from "../controllers/user.controller.ts";

const router = Router();
const userController = new UserController();

// Home/Dashboard
router.get("/", (req, res) => userController.home(req, res));

// Google OAuth routes
router.get("/auth/google", (req, res) => userController.googleAuth(req, res));
router.get("/auth/google/callback", (req, res) =>
  userController.googleCallback(req, res)
);

// Auth routes (legacy - can be removed if not needed)
router.post("/auth/login", (req, res) => userController.login(req, res));
router.post("/auth/logout", (req, res) => userController.logout(req, res));

export default router;
