import type { AuthChangeEvent } from "@supabase/supabase-js";

export function isValidEmailAddress(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export function isPasswordRecoveryEvent(event: AuthChangeEvent): boolean {
  return event === "PASSWORD_RECOVERY";
}

export function nextRecoveryMode(
  currentMode: boolean,
  event: AuthChangeEvent,
): boolean {
  if (isPasswordRecoveryEvent(event)) {
    return true;
  }
  if (event === "SIGNED_OUT") {
    return false;
  }
  return currentMode;
}

export function validateNewPassword(
  password: string,
  confirmation: string,
): string | null {
  if (!password || !confirmation) {
    return "Bitte neues Passwort und Bestätigung eingeben.";
  }
  if (password.length < 6) {
    return "Das Passwort muss mindestens 6 Zeichen lang sein.";
  }
  if (password !== confirmation) {
    return "Die Passwörter stimmen nicht überein.";
  }
  return null;
}
