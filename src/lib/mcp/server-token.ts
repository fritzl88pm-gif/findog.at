import { MAX_MCP_TOKEN_CHARS } from "./config";
import { UserVisibleError } from "../errors";

export function getServerMcpBearerToken(): string {
  const token =
    process.env.BFG_MCP_BEARER_TOKEN?.trim() || process.env.MCP_BEARER_TOKEN?.trim() || "";

  if (!token) {
    throw new UserVisibleError(
      "Serverseitige Datenbank-Konfiguration fehlt. Bitte Administrator kontaktieren.",
      503,
    );
  }

  if (token.length > MAX_MCP_TOKEN_CHARS) {
    throw new UserVisibleError("Serverseitiger Datenbankzugang ist ungültig konfiguriert.", 500);
  }

  return token;
}
