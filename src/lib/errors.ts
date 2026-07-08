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
      "Der BFG-MCP-Server verlangt einen Bearer Token. Bitte serverseitige BFG MCP Konfiguration prüfen.",
      401,
    );
    this.name = "MissingMcpBearerTokenError";
  }
}
