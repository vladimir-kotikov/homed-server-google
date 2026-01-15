import { Request, Response } from "express";
import { AuthService } from "../services/auth.service";
import { TokenService } from "../services/token.service";

const tokenService = new TokenService();
const authService = new AuthService();

export class OAuthController {
  /**
   * GET /oauth/authorize
   * Display login page with OAuth parameters
   */
  async authorize(req: Request, res: Response): Promise<void> {
    const { client_id, redirect_uri, state, response_type } = req.query;

    // Validate required parameters
    if (!client_id || !redirect_uri) {
      res.status(400).json({
        error: "invalid_request",
        error_description: "Missing required parameters",
      });
      return;
    }

    if (response_type !== "code") {
      res.status(400).json({
        error: "unsupported_response_type",
        error_description: "Only authorization code flow is supported",
      });
      return;
    }

    // Validate client_id
    const configuredClientId = process.env.OAUTH_CLIENT_ID;
    if (client_id !== configuredClientId) {
      res.status(400).json({
        error: "invalid_client",
        error_description: "Unknown client",
      });
      return;
    }

    // Return embedded login HTML
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sign in to Homed</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    }
    .container {
      background: white;
      padding: 2rem;
      border-radius: 8px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      width: 100%;
      max-width: 400px;
    }
    h1 {
      margin-top: 0;
      color: #333;
      font-size: 1.5rem;
    }
    .form-group {
      margin-bottom: 1rem;
    }
    label {
      display: block;
      margin-bottom: 0.25rem;
      color: #555;
      font-size: 0.875rem;
    }
    input[type="text"],
    input[type="password"] {
      width: 100%;
      padding: 0.5rem;
      border: 1px solid #ddd;
      border-radius: 4px;
      font-size: 1rem;
      box-sizing: border-box;
    }
    input[type="text"]:focus,
    input[type="password"]:focus {
      outline: none;
      border-color: #667eea;
    }
    button {
      width: 100%;
      padding: 0.75rem;
      background: #667eea;
      color: white;
      border: none;
      border-radius: 4px;
      font-size: 1rem;
      cursor: pointer;
      font-weight: 500;
    }
    button:hover {
      background: #5568d3;
    }
    button:disabled {
      background: #ccc;
      cursor: not-allowed;
    }
    .error {
      color: #e53e3e;
      font-size: 0.875rem;
      margin-top: 0.5rem;
    }
    .info {
      color: #555;
      font-size: 0.875rem;
      margin-top: 1rem;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Sign in to Homed</h1>
    <p class="info">Google Smart Home wants to access your Homed account.</p>

    <form id="loginForm">
      <div class="form-group">
        <label for="username">Username</label>
        <input type="text" id="username" name="username" required autocomplete="username">
      </div>

      <div class="form-group">
        <label for="password">Password</label>
        <input type="password" id="password" name="password" required autocomplete="current-password">
      </div>

      <button type="submit" id="submitBtn">Sign In</button>

      <div id="error" class="error" style="display: none;"></div>
    </form>
  </div>

  <script>
    const form = document.getElementById('loginForm');
    const submitBtn = document.getElementById('submitBtn');
    const errorDiv = document.getElementById('error');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      submitBtn.disabled = true;
      submitBtn.textContent = 'Signing in...';
      errorDiv.style.display = 'none';

      const username = document.getElementById('username').value;
      const password = document.getElementById('password').value;

      try {
        const response = await fetch('/oauth/authorize', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            username,
            password,
            client_id: '${client_id}',
            redirect_uri: '${redirect_uri}',
            state: '${state || ""}',
          }),
        });

        const data = await response.json();

        if (response.ok) {
          // Redirect to callback URL
          window.location.href = data.redirect_uri;
        } else {
          errorDiv.textContent = data.error_description || 'Authentication failed';
          errorDiv.style.display = 'block';
          submitBtn.disabled = false;
          submitBtn.textContent = 'Sign In';
        }
      } catch (error) {
        errorDiv.textContent = 'Network error. Please try again.';
        errorDiv.style.display = 'block';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Sign In';
      }
    });
  </script>
</body>
</html>
    `;

    res.setHeader("Content-Type", "text/html");
    res.send(html);
  }

  /**
   * POST /oauth/authorize
   * Process login credentials and generate authorization code
   */
  async authorizePost(req: Request, res: Response): Promise<void> {
    const { username, password, client_id, redirect_uri, state } = req.body;

    // Validate required parameters
    if (!username || !password) {
      res.status(401).json({
        error: "invalid_request",
        error_description: "Missing username or password",
      });
      return;
    }

    if (!client_id || !redirect_uri) {
      res.status(400).json({
        error: "invalid_request",
        error_description: "Missing OAuth parameters",
      });
      return;
    }

    // Validate client_id
    const configuredClientId = process.env.OAUTH_CLIENT_ID;
    if (client_id !== configuredClientId) {
      res.status(400).json({
        error: "invalid_client",
        error_description: "Unknown client",
      });
      return;
    }

    // Authenticate user
    const user = await authService.validateUserCredentials(username, password);
    if (!user) {
      res.status(401).json({
        error: "invalid_grant",
        error_description: "Invalid username or password",
      });
      return;
    }

    // Generate authorization code
    const code = await tokenService.createAuthCode(
      user.id,
      client_id,
      redirect_uri
    );

    // Build redirect URL
    const redirectUrl = new URL(redirect_uri);
    redirectUrl.searchParams.set("code", code);
    if (state) {
      redirectUrl.searchParams.set("state", state);
    }

    res.json({
      redirect_uri: redirectUrl.toString(),
    });
  }

  /**
   * POST /oauth/token
   * Exchange authorization code or refresh token for access token
   */
  async token(req: Request, res: Response): Promise<void> {
    const {
      grant_type,
      code,
      refresh_token,
      client_id,
      client_secret,
      redirect_uri,
    } = req.body;

    // Validate client credentials
    const configuredClientId = process.env.OAUTH_CLIENT_ID;
    const configuredClientSecret = process.env.OAUTH_CLIENT_SECRET;

    if (
      client_id !== configuredClientId ||
      client_secret !== configuredClientSecret
    ) {
      res.status(401).json({
        error: "invalid_client",
        error_description: "Invalid client credentials",
      });
      return;
    }

    if (grant_type === "authorization_code") {
      // Exchange authorization code for tokens
      if (!code || !redirect_uri) {
        res.status(400).json({
          error: "invalid_request",
          error_description: "Missing code or redirect_uri",
        });
        return;
      }

      const userId = await tokenService.validateAuthCode(
        code,
        client_id,
        redirect_uri
      );
      if (!userId) {
        res.status(400).json({
          error: "invalid_grant",
          error_description: "Invalid or expired authorization code",
        });
        return;
      }

      // Generate tokens
      const accessToken = tokenService.generateAccessToken(userId);
      const refreshToken = await tokenService.generateRefreshToken(userId);

      res.json({
        token_type: "Bearer",
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: 3600, // 1 hour
      });
    } else if (grant_type === "refresh_token") {
      // Refresh access token
      if (!refresh_token) {
        res.status(400).json({
          error: "invalid_request",
          error_description: "Missing refresh_token",
        });
        return;
      }

      const payload = await tokenService.verifyRefreshToken(refresh_token);
      if (!payload) {
        res.status(400).json({
          error: "invalid_grant",
          error_description: "Invalid or expired refresh token",
        });
        return;
      }

      // Generate new access token
      const accessToken = tokenService.generateAccessToken(payload.userId);

      res.json({
        token_type: "Bearer",
        access_token: accessToken,
        expires_in: 3600,
      });
    } else {
      res.status(400).json({
        error: "unsupported_grant_type",
        error_description:
          "Only authorization_code and refresh_token grant types are supported",
      });
    }
  }
}
