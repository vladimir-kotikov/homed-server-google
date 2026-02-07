/* eslint-disable unicorn/no-null */
import bodyParser from "body-parser";
import { ensureLoggedIn } from "connect-ensure-login";
import debug from "debug";
import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import * as oauth2orize from "oauth2orize";
import passport from "passport";
import appConfig from "../config.ts";
import { UserRepository } from "../db/repository.ts";

const log = debug("homed:oauth");

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      oauth2: oauth2orize.OAuth2<Client, User>;
    }
  }
}

interface Client {
  id: string;
}

interface User {
  id: string;
}

type CodeIssueCallback = (error: Error | null, code?: string | false) => void;
type TokenExchangeCallback = (
  error: Error | null,
  accessToken?: string | false,
  refreshToken?: string,
  parameters?: { expires_in?: number }
) => void;

export class OAuthController {
  private userRepository: UserRepository;
  private googleHomeClientId: string;
  private oauth2Server: oauth2orize.OAuth2Server<Client, User>;
  private allowedRedirectUris: Set<string>;

  constructor(
    userRepository: UserRepository,
    googleHomeClientId: string,
    googleHomeProjectId: string
  ) {
    this.userRepository = userRepository;
    this.googleHomeClientId = googleHomeClientId;

    this.allowedRedirectUris = new Set([
      `https://oauth-redirect.googleusercontent.com/r/${googleHomeProjectId}`,
      `https://oauth-redirect-sandbox.googleusercontent.com/r/${googleHomeProjectId}`,
    ]);

    this.oauth2Server = oauth2orize
      .createServer<Client, User>()
      .grant(oauth2orize.grant.code(this.grantCode))
      .exchange(oauth2orize.exchange.code(this.exchangeCode))
      .exchange(oauth2orize.exchange.refreshToken(this.exchangeToken));

    this.oauth2Server.serializeClient((client, done) => done(null, client.id));
    this.oauth2Server.deserializeClient((id, done) =>
      done(null, this.isValidClient(id) && { id })
    );
  }

  private isValidClient = (clientId: string, redirectUri?: string): boolean =>
    clientId === this.googleHomeClientId &&
    (!redirectUri || this.allowedRedirectUris.has(redirectUri));

  private grantCode = (
    client: Client,
    redirectUri: string,
    user: User,
    done: CodeIssueCallback
  ) =>
    done(
      null,
      this.isValidClient(client.id, redirectUri)
        ? this.userRepository.issueCode(user.id, client.id, redirectUri)
        : false
    );

  private exchangeCode = (
    client: Client,
    code: string,
    redirectUri: string,
    done: TokenExchangeCallback
  ): void => {
    log("Exchanging authorization code", {
      clientId: client.id,
      redirectUri,
      codeValid: !!code,
    });
    if (this.isValidClient(client.id, redirectUri)) {
      this.userRepository.exchangeCode(code, client.id, redirectUri).then(
        args => {
          log("Authorization code exchanged successfully", {
            clientId: client.id,
            hasTokens: !!args,
          });
          if (args === undefined) {
            done(null, false);
          } else {
            // Include expires_in as required by Google
            done(null, args[0], args[1], {
              expires_in: appConfig.accessTokenLifetime,
            });
          }
        },
        error => {
          log("Authorization code exchange failed", {
            clientId: client.id,
            error: error instanceof Error ? error.message : String(error),
          });
          done(error);
        }
      );
    } else {
      done(null, false);
    }
  };

  private exchangeToken = (
    client: Client,
    token: string,
    done: TokenExchangeCallback
  ): void => {
    log("Exchanging refresh token", { clientId: client.id });
    if (this.isValidClient(client.id)) {
      this.userRepository.exchangeRefreshToken(token).then(
        args => {
          log("Refresh token exchanged successfully", {
            clientId: client.id,
            hasTokens: !!args,
          });
          if (args === undefined) {
            done(null, false);
          } else {
            // Include expires_in as required by Google
            done(null, args[0], args[1], {
              expires_in: appConfig.accessTokenLifetime,
            });
          }
        },
        error => {
          log("Refresh token exchange failed", {
            clientId: client.id,
            error: error instanceof Error ? error.message : String(error),
          });
          done(error);
        }
      );
    } else {
      done(null, false);
    }
  };

  private authorizeClient = (
    clientId: string,
    redirectUri: string,
    done: (
      error: Error | null,
      client: Client | false,
      redirectUri?: string
    ) => void
  ): void =>
    // TODO: valid scopes are unknown as google docs do not specify them
    // scope === GOOGLE_HOME_ALLOWES_SCOPE
    this.isValidClient(clientId, redirectUri)
      ? done(null, { id: clientId }, redirectUri)
      : done(null, false);

  private userinfoHandler = async (request: Request, response: Response) => {
    const { user } = request as Express.AuthenticatedRequest;
    return response.json({
      sub: user.id,
      email: user.username,
      name: user.username,
    });
  };

  private errorHandler = (
    error: Error,
    request: Request,
    response: Response
  ): void => {
    // Handle JWT/authentication errors
    if (
      error.name === "UnauthorizedError" ||
      error.message?.includes("No auth") ||
      error.message?.includes("invalid token")
    ) {
      log("JWT authentication error", { error: error.message });
      response.set("WWW-Authenticate", 'Bearer realm="api"');
      response.status(401).json({
        error: "invalid_token",
        error_description: "The access token provided is invalid or expired",
      });
    } else {
      log("OAuth error", { error: error.message, status: 400 });
      response.status(400).json({
        error: "invalid_request",
        error_description: error.message,
      });
    }
  };

  get routes() {
    return Router()
      .use(bodyParser.urlencoded({ extended: false }))
      .get(
        "/authorize",
        ensureLoggedIn(),
        this.oauth2Server.authorize(this.authorizeClient),
        (request, response) => {
          try {
            response.render("consent", {
              // TODO: Pass client name and proper scopes
              clientId: request.oauth2.client.id,
              scopes: request.oauth2.req.scope,
              transaction_id: request.oauth2.transactionID,
            });
          } catch (error) {
            log("Error rendering consent page", {
              error: error instanceof Error ? error.message : String(error),
            });
            response.status(500).json({
              error: "server_error",
              error_description: "Failed to render consent page",
            });
          }
        }
      )
      .post(
        "/authorize/consent",
        ensureLoggedIn(),
        this.oauth2Server.decision()
      )
      .post(
        "/token",
        passport.authenticate("client-password-oauth20", { session: false }),
        this.oauth2Server.token(),
        this.oauth2Server.errorHandler()
      )
      .get(
        "/userinfo",
        (request: Request, response: Response, next: NextFunction) => {
          passport.authenticate(
            "jwt",
            { session: false },
            (authError: Error | null, user: User | false) => {
              // Handle JWT authentication errors
              if (authError) {
                log("JWT auth error", {
                  error: authError.message,
                });
                response.set("WWW-Authenticate", 'Bearer realm="api"');
                return response.status(401).json({
                  error: "invalid_token",
                  error_description: authError.message,
                });
              }

              // Handle no user returned (invalid/missing token)
              if (!user) {
                log("JWT auth failed: no user");
                response.set("WWW-Authenticate", 'Bearer realm="api"');
                return response.status(401).json({
                  error: "invalid_token",
                  error_description:
                    "The access token provided is invalid or expired",
                });
              }

              // Authentication successful
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              request.user = user as any;
              this.userinfoHandler(request, response);
            }
          )(request, response, next);
        }
      )
      .use(this.errorHandler);
  }
}
