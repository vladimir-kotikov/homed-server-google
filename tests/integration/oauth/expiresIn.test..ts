import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import appConfig from "../../../src/config.ts";
import type { UserRepository } from "../../../src/db/repository.ts";
import { WebApp } from "../../../src/web/app.ts";
import { OAuthController } from "../../../src/web/oauth.ts";
import { createTestUserRepository } from "../testDatabase.ts";

const CLIENT_ID = appConfig.googleHomeOAuthClientId;
const CLIENT_SECRET = appConfig.googleHomeOAuthClientSecret;
const PROJECT_ID = appConfig.googleHomeProjectId;
const REDIRECT_URI = `https://oauth-redirect.googleusercontent.com/r/${PROJECT_ID}`;

describe("Verify expires_in in token response", () => {
  let webApp: WebApp;
  let userRepository: UserRepository;
  let testUserId: string;

  beforeEach(() => {
    const { repository, user } = createTestUserRepository(
      appConfig.jwtSecret || "test-secret"
    );
    userRepository = repository;
    testUserId = user.id;

    const oauthController = new OAuthController(
      userRepository,
      CLIENT_ID,
      PROJECT_ID
    );

    const mockFulfillmentController = {
      handleFulfillment: () => Promise.resolve({}),
    } as any;

    const deviceRepository: any = {};

    webApp = new WebApp(
      userRepository,
      mockFulfillmentController,
      oauthController,
      deviceRepository
    );
  });

  it("Token exchange response MUST include expires_in field", async () => {
    // Create a valid authorization code
    const code = userRepository.issueCode(testUserId, CLIENT_ID, REDIRECT_URI);

    // Exchange the code for tokens
    const response = await request(webApp.app)
      .post("/oauth/token")
      .type("form")
      .send({
        grant_type: "authorization_code",
        code: code,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      });

    // Verify status
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      token_type: "Bearer",
      access_token: expect.any(String),
      refresh_token: expect.any(String),
      expires_in: 3600,
    });
  });

  it("Refresh token exchange MUST also include expires_in field", async () => {
    // Create initial tokens
    const code = userRepository.issueCode(testUserId, CLIENT_ID, REDIRECT_URI);

    const initialResponse = await request(webApp.app)
      .post("/oauth/token")
      .type("form")
      .send({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      });

    const refreshToken = initialResponse.body.refresh_token;

    // Exchange refresh token
    const response = await request(webApp.app)
      .post("/oauth/token")
      .type("form")
      .send({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      });

    // Verify status
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      token_type: "Bearer",
      access_token: expect.any(String),
      refresh_token: expect.any(String),
      expires_in: 3600,
    });
  });
});
