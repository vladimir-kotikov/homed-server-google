/* eslint-disable unicorn/no-null */
import bodyParser from "body-parser";
import { ensureLoggedIn } from "connect-ensure-login";
import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import * as oauth2orize from "oauth2orize";
import passport from "passport";
import appConfig from "../config.ts";
import { UserRepository, type UserId } from "../db/repository.ts";

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
  id: UserId;
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
  private allowedScopes: Set<string>;

  constructor(
    userRepository: UserRepository,
    googleHomeClientId: string,
    googleHomeProjectId: string,
    googleHomeAllowedScopes: string[] = ["email"]
  ) {
    this.userRepository = userRepository;
    this.googleHomeClientId = googleHomeClientId;

    this.allowedRedirectUris = new Set([
      `https://oauth-redirect.googleusercontent.com/r/${googleHomeProjectId}`,
      `https://oauth-redirect-sandbox.googleusercontent.com/r/${googleHomeProjectId}`,
    ]);
    this.allowedScopes = new Set(googleHomeAllowedScopes);

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

  private isValidClient = (
    clientId: string,
    redirectUri?: string,
    scopes?: string[]
  ): boolean =>
    clientId === this.googleHomeClientId &&
    (!redirectUri || this.allowedRedirectUris.has(redirectUri)) &&
    (!scopes || new Set(scopes).isSubsetOf(this.allowedScopes));

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
    if (!this.isValidClient(client.id, redirectUri)) {
      return done(null, false);
    }

    this.userRepository
      .exchangeCode(code, client.id, redirectUri)
      .then(args => {
        if (args === undefined) {
          return done(null, false);
        }

        const [accessToken, refreshToken] = args;
        // Include expires_in as required by Google
        done(null, accessToken, refreshToken, {
          expires_in: appConfig.accessTokenLifetime,
        });
      }, done);
  };

  private exchangeToken = (
    client: Client,
    token: string,
    done: TokenExchangeCallback
  ): void => {
    if (!this.isValidClient(client.id)) {
      return done(null, false);
    }

    this.userRepository.exchangeRefreshToken(token).then(args => {
      if (args === undefined) {
        return done(null, false);
      }
      const [accessToken, refreshToken] = args;
      // Include expires_in as required by Google
      done(null, accessToken, refreshToken, {
        expires_in: appConfig.accessTokenLifetime,
      });
    }, done);
  };

  private authorizeClient = (
    clientId: string,
    redirectUri: string,
    scopes: string[],
    done: (
      error: Error | null,
      client: Client | false,
      redirectUri?: string
    ) => void
  ): void =>
    this.isValidClient(clientId, redirectUri, scopes)
      ? done(null, { id: clientId }, redirectUri)
      : done(null, false);

  private userinfoHandler = async (req: Request, res: Response) => {
    const { user } = req as Express.AuthenticatedRequest;
    res.json({
      sub: user.id,
      email: user.username,
      name: user.username,
    });
  };

  get routes() {
    return Router()
      .use(bodyParser.urlencoded({ extended: false }))
      .get(
        "/authorize",
        ensureLoggedIn(),
        this.oauth2Server.authorize(this.authorizeClient),
        (request, response) => {
          response.render("consent", {
            // TODO: Pass client name and proper scopes
            clientId: request.oauth2.client.id,
            scopes: request.oauth2.req.scope,
            transaction_id: request.oauth2.transactionID,
          });
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
      .get("/userinfo", (req: Request, res: Response, next: NextFunction) => {
        passport.authenticate(
          "jwt",
          { session: false },
          (authError: Error | null, user: User | false) => {
            // Handle JWT authentication errors
            if (authError) {
              res.set("WWW-Authenticate", 'Bearer realm="api"');
              return res.status(401).json({
                error: "invalid_token",
                error_description: authError.message,
              });
            }

            // Handle no user returned (invalid/missing token)
            if (!user) {
              res.set("WWW-Authenticate", 'Bearer realm="api"');
              return res.status(401).json({
                error: "invalid_token",
                error_description:
                  "The access token provided is invalid or expired",
              });
            }

            // Authentication successful
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            req.user = user as any;
            this.userinfoHandler(req, res);
          }
        )(req, res, next);
      });
  }
}
