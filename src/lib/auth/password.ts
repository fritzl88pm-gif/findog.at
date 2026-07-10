import { UserVisibleError } from "../errors";

export type PasswordChangeInput = {
  currentPassword: string;
  newPassword: string;
  confirmation: string;
};

const PASSWORD_CHANGE_FIELDS = [
  "confirmation",
  "currentPassword",
  "newPassword",
] as const;

export function parsePasswordChangeBody(body: unknown): PasswordChangeInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new UserVisibleError("Die Passwortanfrage ist ungültig.", 400);
  }

  const record = body as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (
    keys.length !== PASSWORD_CHANGE_FIELDS.length
    || keys.some((key, index) => key !== PASSWORD_CHANGE_FIELDS[index])
    || typeof record.currentPassword !== "string"
    || typeof record.newPassword !== "string"
    || typeof record.confirmation !== "string"
  ) {
    throw new UserVisibleError("Die Passwortanfrage enthält ungültige Felder.", 400);
  }

  const currentPassword = record.currentPassword;
  const newPassword = record.newPassword;
  const confirmation = record.confirmation;

  if (!currentPassword) {
    throw new UserVisibleError("Bitte aktuelles Passwort eingeben.", 400);
  }
  if (!newPassword || !confirmation) {
    throw new UserVisibleError("Bitte neues Passwort und Bestätigung eingeben.", 400);
  }
  if (newPassword.length < 6) {
    throw new UserVisibleError("Das neue Passwort muss mindestens 6 Zeichen lang sein.", 400);
  }
  if (newPassword !== confirmation) {
    throw new UserVisibleError("Die neuen Passwörter stimmen nicht überein.", 400);
  }

  return { currentPassword, newPassword, confirmation };
}
