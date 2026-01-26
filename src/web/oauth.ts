/* eslint-disable unicorn/no-null */
import bodyParser from "body-parser";
import { ensureLoggedIn } from "connect-ensure-login";
import { Router } from "express";
import * as oauth2orize from "oauth2orize";
import passport from "passport";
import { UserRepository } from "../db/repository.ts";

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
  redirectUri: string;
}

interface User {
  id: string;
}

type CodeIssueCallback = (error: Error | null, code?: string | false) => void;
type TokenExchangeCallback = (
  error: Error | null,
  accessToken?: string | false,
  refreshToken?: string
) => void;

export class OAuthController {
  private userRepository: UserRepository;
  private configuredClientId: string;
  private configuredRedirectUri: string;
  private oauth2Server: oauth2orize.OAuth2Server<Client, User>;

  constructor(
    userRepository: UserRepository,
    configuredClientId: string,
    configuredRedirectUri: string
  ) {
    this.userRepository = userRepository;
    this.configuredClientId = configuredClientId;
    this.configuredRedirectUri = configuredRedirectUri;

    this.oauth2Server = oauth2orize
      .createServer<Client, User>()
      .grant(oauth2orize.grant.code(this.grantCode))
      .exchange(oauth2orize.exchange.code(this.exchangeCode))
      .exchange(oauth2orize.exchange.refreshToken(this.exchangeToken));

    this.oauth2Server.serializeClient((client, done) => done(null, client.id));
    this.oauth2Server.deserializeClient((id, done) =>
      done(
        null,
        id === this.configuredClientId
          ? { id, redirectUri: this.configuredRedirectUri }
          : false
      )
    );
  }

  private isValidClient = (clientId: string, redirectUri?: string): boolean =>
    clientId === this.configuredClientId &&
    (!redirectUri || this.configuredRedirectUri === redirectUri);

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
  ) =>
    this.isValidClient(client.id, redirectUri)
      ? this.userRepository.exchangeCode(code, client.id, redirectUri).then(
          args =>
            args === undefined ? done(null, false) : done(null, ...args),
          error => done(error)
        )
      : done(null, false);

  private exchangeToken = (
    client: Client,
    token: string,
    done: TokenExchangeCallback
  ) =>
    this.isValidClient(client.id)
      ? this.userRepository.exchangeRefreshToken(token).then(
          args =>
            args === undefined ? done(null, false) : done(null, ...args),
          error => done(error)
        )
      : done(null, false);

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
      ? done(null, { id: clientId, redirectUri }, redirectUri)
      : done(null, false);

  get routes() {
    return Router()
      .use(bodyParser.urlencoded())
      .get(
        "/authorize",
        ensureLoggedIn(),
        this.oauth2Server.authorize(this.authorizeClient),
        (request, response) =>
          response.render("oauth-consent", {
            // TODO: Pass client name and proper scopes
            clientId: request.oauth2.client.id,
            scopes: request.oauth2.req.scope,
            transaction_id: request.oauth2.transactionID,
          })
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
      );
  }
}
