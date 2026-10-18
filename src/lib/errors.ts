export class UserVisibleError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "UserVisibleError";
    this.status = status;
  }
}

/**
 * WeKnora rejected the embed session token (HTTP 401/403), for example after
 * its token store was reset. Holders of a cached token mint a fresh one.
 */
export class FredEmbedSessionRejectedError extends UserVisibleError {
  constructor() {
    super("Die sichere Fred-Verbindung ist abgelaufen.", 502);
    this.name = "FredEmbedSessionRejectedError";
  }
}

export class MissingMcpBearerTokenError extends UserVisibleError {
  constructor() {
    super(
      "Der Datenbankzugang ist serverseitig nicht konfiguriert. Bitte Administrator kontaktieren.",
      401,
    );
    this.name = "MissingMcpBearerTokenError";
  }
}
