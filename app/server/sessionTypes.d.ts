import "express-session";

declare module "express-session" {
  interface SessionData {
    userId?: string;
    organizationId?: string;
    mfaVerifiedAt?: string;
    mcpAuthorize?: {
      clientId: string;
      clientName: string;
      redirectUri: string;
      codeChallenge: string;
      state?: string;
      scope: string;
      csrf: string;
    };
  }
}
