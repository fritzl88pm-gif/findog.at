import type { SupabaseClient, User } from "@supabase/supabase-js";

import { isAdminUser } from "./admin-settings";
import { authenticateSupabaseRequest, type AuthenticatedUser } from "./auth/server";
import { UserVisibleError } from "./errors";

type ServerSupabaseClient = SupabaseClient;

export const MIN_MANAGED_USER_PASSWORD_LENGTH = 6;
export const MAX_MANAGED_USER_PASSWORD_LENGTH = 72;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ManagedUserInput = {
  email: string;
  password: string;
};

export type ManagedUserSummary = {
  id: string;
  email: string;
  createdAt: string;
  lastSignInAt: string | null;
};

export async function authenticateAdminRequest(
  request: Request,
  supabase: ServerSupabaseClient,
): Promise<AuthenticatedUser> {
  const user = await authenticateSupabaseRequest(request, supabase);
  if (!await isAdminUser(supabase, user.id)) {
    throw new UserVisibleError("Du hast keine Administrationsberechtigung.", 403);
  }
  return user;
}

export function parseManagedUserId(value: string): string {
  const userId = value.trim();
  if (!uuidPattern.test(userId)) {
    throw new UserVisibleError("Benutzer-ID ist ungültig.", 400);
  }
  return userId;
}

export function parseManagedUserInput(body: unknown): ManagedUserInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new UserVisibleError("Die Benutzerangaben sind ungültig.", 400);
  }

  const record = body as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (
    keys.length !== 2
    || keys[0] !== "email"
    || keys[1] !== "password"
    || typeof record.email !== "string"
    || typeof record.password !== "string"
  ) {
    throw new UserVisibleError("Die Benutzerangaben enthalten ungültige Felder.", 400);
  }

  const email = record.email.trim().toLowerCase();
  if (!emailPattern.test(email)) {
    throw new UserVisibleError("Bitte eine gültige E-Mail-Adresse eingeben.", 400);
  }
  if (record.password.length < MIN_MANAGED_USER_PASSWORD_LENGTH) {
    throw new UserVisibleError(
      `Das Passwort muss mindestens ${MIN_MANAGED_USER_PASSWORD_LENGTH} Zeichen lang sein.`,
      400,
    );
  }
  if (record.password.length > MAX_MANAGED_USER_PASSWORD_LENGTH) {
    throw new UserVisibleError(
      `Das Passwort darf maximal ${MAX_MANAGED_USER_PASSWORD_LENGTH} Zeichen lang sein.`,
      400,
    );
  }

  return { email, password: record.password };
}

export function managedUserSummary(user: User): ManagedUserSummary {
  return {
    id: user.id,
    email: user.email ?? "",
    createdAt: user.created_at,
    lastSignInAt: user.last_sign_in_at ?? null,
  };
}

export function adminUsersErrorResponse(error: unknown, fallback: string): Response {
  if (error instanceof UserVisibleError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  return Response.json({ error: fallback }, { status: 500 });
}
