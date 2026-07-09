export class UserVisibleError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "UserVisibleError";
    this.status = status;
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
