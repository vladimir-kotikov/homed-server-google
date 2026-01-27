declare module "express-https-redirect" {
  import { RequestHandler } from "express";

  /**
   * Express middleware to redirect HTTP requests to HTTPS.
   * Checks req.secure, x-arr-ssl (Azure), and x-forwarded-proto (AWS/reverse proxies).
   * Skips redirect for localhost by default.
   * @param redirectLocalhost Force HTTPS redirect even for localhost (default: false)
   * @returns Express request handler middleware
   */
  function httpsRedirect(redirectLocalhost?: boolean): RequestHandler;

  export = httpsRedirect;
}
