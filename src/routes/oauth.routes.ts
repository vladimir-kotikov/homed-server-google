import { Router } from "express";
import { OAuthController } from "../controllers/oauth.controller.ts";

const router = Router();
const oauthController = new OAuthController();

// GET /oauth/authorize - Display login page
router.get("/authorize", (req, res) => oauthController.authorize(req, res));

// POST /oauth/authorize - Process login and generate auth code
router.post("/authorize", (req, res) =>
  oauthController.authorizePost(req, res)
);

// POST /oauth/token - Exchange auth code or refresh token for access token
router.post("/token", (req, res) => oauthController.token(req, res));

export default router;
