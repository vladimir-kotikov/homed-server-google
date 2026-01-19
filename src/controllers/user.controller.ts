import * as crypto from "crypto";
import type { Request, Response } from "express";
import type { Session } from "express-session";
import { OAuth2Client } from "google-auth-library";
import { AuthService } from "../services/auth.service.ts";

const authService = new AuthService();

// Type for request with session
type RequestWithSession = Request & {
  session?: Session & { userId?: string };
};

// Type for session destroy callback
interface SessionError extends Error {
  message: string;
}

// Google OAuth client for user authentication (lazy initialized)
let googleOAuthClient: OAuth2Client | null = null;

function getGoogleOAuthClient(): OAuth2Client {
  if (!googleOAuthClient) {
    const clientId = process.env.GOOGLE_USER_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_USER_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_USER_REDIRECT_URI;

    if (!clientId || !clientSecret || !redirectUri) {
      throw new Error(
        "Google OAuth credentials not configured. " +
          "Please set GOOGLE_USER_CLIENT_ID, GOOGLE_USER_CLIENT_SECRET, and GOOGLE_USER_REDIRECT_URI"
      );
    }

    googleOAuthClient = new OAuth2Client(clientId, clientSecret, redirectUri);
  }
  return googleOAuthClient;
}

export class UserController {
  /**
   * GET /
   * Display login/register page or dashboard if authenticated
   */
  async home(req: RequestWithSession, res: Response): Promise<void> {
    const userId = req.session?.userId;

    if (userId) {
      // User is logged in, show dashboard
      const user = await authService.getUserById(userId);
      if (user) {
        return this.renderDashboard(res, user.username, user.clientToken);
      }
    }

    // Show Google Sign-In page
    this.renderGoogleSignIn(res);
  }

  /**
   * GET /auth/google
   * Initiate Google OAuth flow
   */
  async googleAuth(req: Request, res: Response): Promise<void> {
    const authUrl = getGoogleOAuthClient().generateAuthUrl({
      access_type: "offline",
      scope: [
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/userinfo.profile",
      ],
    });
    res.redirect(authUrl);
  }

  /**
   * GET /auth/google/callback
   * Handle Google OAuth callback
   */
  async googleCallback(req: RequestWithSession, res: Response): Promise<void> {
    const { code } = req.query;

    if (!code || typeof code !== "string") {
      res.status(400).send("Missing authorization code");
      return;
    }

    try {
      const client = getGoogleOAuthClient();
      // Exchange code for tokens
      const { tokens } = await client.getToken(code);
      client.setCredentials(tokens);

      // Get user info
      const ticket = await client.verifyIdToken({
        idToken: tokens.id_token!,
        audience: process.env.GOOGLE_USER_CLIENT_ID,
      });
      const payload = ticket.getPayload();

      if (!payload || !payload.email) {
        res.status(400).send("Failed to get user information");
        return;
      }

      // Find or create user by email
      let user = await authService.getUserByUsername(payload.email);
      if (!user) {
        user = await authService.createUser(
          payload.email,
          crypto.randomBytes(32).toString("hex")
        );
      }

      if (req.session) {
        req.session.userId = user.id;
      }

      // Redirect to home page
      res.redirect("/");
    } catch (error) {
      console.error("Google OAuth error:", error);
      res.status(500).send("Authentication failed");
    }
  }

  /**
   * POST /auth/login
   * Process login credentials
   */
  async login(req: RequestWithSession, res: Response): Promise<void> {
    const { username, password } = req.body;

    if (!username || !password) {
      res.status(400).json({
        error: "Missing username or password",
      });
      return;
    }

    const user = await authService.validateUserCredentials(username, password);
    if (!user) {
      res.status(401).json({
        error: "Invalid username or password",
      });
      return;
    }

    if (req.session) {
      req.session.userId = user.id;
    }

    res.json({
      success: true,
      username: user.username,
      clientToken: user.clientToken,
    });
  }

  /**
   * POST /auth/logout
   * Logout user
   */
  async logout(req: RequestWithSession, res: Response): Promise<void> {
    req.session?.destroy((err: SessionError | null) => {
      if (err) {
        res.status(500).json({ error: "Failed to logout" });
      } else {
        res.json({ success: true });
      }
    });
  }

  /**
   * Render Google Sign-In page
   */
  private renderGoogleSignIn(res: Response): void {
    const isTest = process.env.NODE_ENV === "test";

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Homed Server - Sign In</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    }
    .container {
      background: white;
      padding: 3rem;
      border-radius: 12px;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.2);
      width: 100%;
      max-width: 420px;
      text-align: center;
    }
    h1 {
      color: #333;
      font-size: 2rem;
      margin-bottom: 0.5rem;
    }
    .subtitle {
      color: #666;
      font-size: 1rem;
      margin-bottom: 3rem;
    }
    .google-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      padding: 0.875rem 1.5rem;
      background: white;
      color: #757575;
      border: 2px solid #e0e0e0;
      border-radius: 6px;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      text-decoration: none;
      transition: all 0.3s;
    }
    .google-btn:hover {
      background: #f7f7f7;
      border-color: #d0d0d0;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    }
    .google-icon {
      width: 20px;
      height: 20px;
      margin-right: 12px;
    }
    .divider {
      margin: 2rem 0;
      text-align: center;
      position: relative;
    }
    .divider::before {
      content: '';
      position: absolute;
      left: 0;
      top: 50%;
      width: 100%;
      height: 1px;
      background: #e0e0e0;
    }
    .divider span {
      position: relative;
      background: white;
      padding: 0 1rem;
      color: #999;
      font-size: 0.875rem;
    }
    .test-login {
      text-align: left;
    }
    .form-group {
      margin-bottom: 1rem;
    }
    label {
      display: block;
      margin-bottom: 0.5rem;
      color: #333;
      font-size: 0.875rem;
      font-weight: 500;
      text-align: left;
    }
    input[type="text"],
    input[type="password"] {
      width: 100%;
      padding: 0.75rem;
      border: 2px solid #e0e0e0;
      border-radius: 6px;
      font-size: 1rem;
      transition: border-color 0.3s;
    }
    input[type="text"]:focus,
    input[type="password"]:focus {
      outline: none;
      border-color: #667eea;
    }
    button[type="submit"] {
      width: 100%;
      padding: 0.875rem;
      background: #667eea;
      color: white;
      border: none;
      border-radius: 6px;
      font-size: 1rem;
      cursor: pointer;
      font-weight: 600;
      transition: background 0.3s;
    }
    button[type="submit"]:hover {
      background: #5568d3;
    }
    button[type="submit"]:disabled {
      background: #ccc;
      cursor: not-allowed;
    }
    .error {
      color: #e53e3e;
      font-size: 0.875rem;
      margin-top: 1rem;
      padding: 0.75rem;
      background: #fff5f5;
      border-radius: 6px;
      border-left: 4px solid #e53e3e;
      display: none;
    }
    .error.show {
      display: block;
    }
    .info {
      margin-top: 2rem;
      padding-top: 2rem;
      border-top: 1px solid #e0e0e0;
      color: #666;
      font-size: 0.875rem;
      line-height: 1.5;
    }
    .test-badge {
      display: inline-block;
      background: #fbbf24;
      color: #92400e;
      padding: 0.25rem 0.75rem;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 600;
      margin-bottom: 1rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🏠 Homed Server</h1>
    <p class="subtitle">Google Smart Home Integration</p>

    ${isTest ? '<div class="test-badge">TEST ENVIRONMENT</div>' : ""}

    <a href="/auth/google" class="google-btn">
      <svg class="google-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
      </svg>
      Sign in with Google
    </a>

    ${
      isTest
        ? `
    <div class="divider">
      <span>OR (Test Only)</span>
    </div>

    <div class="test-login">
      <form onsubmit="handleTestLogin(event)">
        <div class="form-group">
          <label for="username">Username</label>
          <input type="text" id="username" name="username" value="test" required autocomplete="username">
        </div>
        <div class="form-group">
          <label for="password">Password</label>
          <input type="password" id="password" name="password" value="test" required autocomplete="current-password">
        </div>
        <button type="submit" id="loginBtn">Test Login</button>
        <div id="loginError" class="error"></div>
      </form>
    </div>
    `
        : `
    <div class="info">
      You need a confirmed email address to use this service.<br>
      Sign in with your Google account to continue.
    </div>
    `
    }
  </div>

  ${
    isTest
      ? `
  <script>
    async function handleTestLogin(e) {
      e.preventDefault();
      const btn = document.getElementById('loginBtn');
      const errorDiv = document.getElementById('loginError');

      btn.disabled = true;
      btn.textContent = 'Signing in...';
      errorDiv.classList.remove('show');

      const username = document.getElementById('username').value;
      const password = document.getElementById('password').value;

      try {
        const response = await fetch('/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        });

        const data = await response.json();

        if (response.ok) {
          window.location.reload();
        } else {
          errorDiv.textContent = data.error || 'Login failed';
          errorDiv.classList.add('show');
          btn.disabled = false;
          btn.textContent = 'Test Login';
        }
      } catch (error) {
        errorDiv.textContent = 'Network error. Please try again.';
        errorDiv.classList.add('show');
        btn.disabled = false;
        btn.textContent = 'Test Login';
      }
    }
  </script>
  `
      : ""
  }
</body>
</html>
    `;

    res.setHeader("Content-Type", "text/html");
    res.send(html);
  }

  /**
   * Render dashboard with client token
   */
  private renderDashboard(
    res: Response,
    username: string,
    clientToken: string
  ): void {
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Homed Server - Dashboard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: #f5f5f5;
      min-height: 100vh;
    }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 1.5rem 2rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    }
    .header h1 {
      font-size: 1.5rem;
    }
    .header .user-info {
      display: flex;
      align-items: center;
      gap: 1rem;
    }
    .header .username {
      font-weight: 600;
    }
    .logout-btn {
      padding: 0.5rem 1rem;
      background: rgba(255, 255, 255, 0.2);
      border: 1px solid rgba(255, 255, 255, 0.3);
      color: white;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.875rem;
      transition: all 0.3s;
    }
    .logout-btn:hover {
      background: rgba(255, 255, 255, 0.3);
    }
    .container {
      max-width: 800px;
      margin: 2rem auto;
      padding: 0 1rem;
    }
    .card {
      background: white;
      border-radius: 12px;
      padding: 2rem;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      margin-bottom: 1.5rem;
    }
    .card h2 {
      color: #333;
      font-size: 1.25rem;
      margin-bottom: 1rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .card p {
      color: #666;
      line-height: 1.6;
      margin-bottom: 1rem;
    }
    .token-container {
      background: #f8f9fa;
      border: 2px solid #e0e0e0;
      border-radius: 8px;
      padding: 1rem;
      margin-top: 1rem;
      position: relative;
    }
    .token-label {
      font-size: 0.75rem;
      color: #666;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 0.5rem;
    }
    .token-value {
      font-family: 'Monaco', 'Menlo', 'Courier New', monospace;
      font-size: 0.875rem;
      color: #333;
      word-break: break-all;
      user-select: all;
    }
    .copy-btn {
      position: absolute;
      top: 1rem;
      right: 1rem;
      padding: 0.5rem 1rem;
      background: #667eea;
      color: white;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.75rem;
      font-weight: 600;
      transition: background 0.3s;
    }
    .copy-btn:hover {
      background: #5568d3;
    }
    .copy-btn.copied {
      background: #48bb78;
    }
    .info-grid {
      display: grid;
      gap: 1rem;
      margin-top: 1rem;
    }
    .info-item {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    .info-icon {
      width: 40px;
      height: 40px;
      background: #667eea;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-size: 1.25rem;
    }
    .info-content h3 {
      color: #333;
      font-size: 0.875rem;
      font-weight: 600;
      margin-bottom: 0.25rem;
    }
    .info-content p {
      color: #666;
      font-size: 0.875rem;
      margin: 0;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>🏠 Homed Server</h1>
    <div class="user-info">
      <span class="username">${username}</span>
      <button class="logout-btn" onclick="handleLogout()">Logout</button>
    </div>
  </div>

  <div class="container">
    <div class="card">
      <h2>🔑 TCP Server Token</h2>
      <p>Use this token to connect your Homed devices to the Google Smart Home integration via the TCP server.</p>

      <div class="token-container">
        <div class="token-label">Client Token</div>
        <div class="token-value">${clientToken}</div>
        <button class="copy-btn" onclick="copyToken()">Copy</button>
      </div>
    </div>

    <div class="card">
      <h2>📋 Connection Information</h2>
      <div class="info-grid">
        <div class="info-item">
          <div class="info-icon">🌐</div>
          <div class="info-content">
            <h3>TCP Server</h3>
            <p>Port: <strong>${process.env.TCP_PORT || "8042"}</strong></p>
          </div>
        </div>
        <div class="info-item">
          <div class="info-icon">🔒</div>
          <div class="info-content">
            <h3>Encryption</h3>
            <p>DH handshake + AES-128-CBC</p>
          </div>
        </div>
        <div class="info-item">
          <div class="info-icon">📱</div>
          <div class="info-content">
            <h3>Integration</h3>
            <p>Google Smart Home</p>
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>💡 Next Steps</h2>
      <p><strong>1. Configure your homed-service-cloud client:</strong></p>
      <p style="margin-left: 1rem;">Add your client token to the configuration file and point it to this server.</p>

      <p style="margin-top: 1rem;"><strong>2. Set up Google Smart Home:</strong></p>
      <p style="margin-left: 1rem;">Link your Google account through the OAuth flow to control devices via Google Assistant.</p>
    </div>
  </div>

  <script>
    async function handleLogout() {
      try {
        await fetch('/auth/logout', { method: 'POST' });
        window.location.reload();
      } catch (error) {
        alert('Failed to logout');
      }
    }

    async function copyToken() {
      const tokenValue = document.querySelector('.token-value').textContent;
      const btn = document.querySelector('.copy-btn');

      try {
        await navigator.clipboard.writeText(tokenValue);
        btn.textContent = 'Copied!';
        btn.classList.add('copied');

        setTimeout(() => {
          btn.textContent = 'Copy';
          btn.classList.remove('copied');
        }, 2000);
      } catch (error) {
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = tokenValue;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);

        btn.textContent = 'Copied!';
        btn.classList.add('copied');
        setTimeout(() => {
          btn.textContent = 'Copy';
          btn.classList.remove('copied');
        }, 2000);
      }
    }
  </script>
</body>
</html>
    `;

    res.setHeader("Content-Type", "text/html");
    res.send(html);
  }
}
