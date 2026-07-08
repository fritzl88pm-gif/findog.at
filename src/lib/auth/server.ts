import type { User } from "@supabase/supabase-js";

import { UserVisibleError } from "../errors";

type SupabaseAuthClient = {
  auth: {
    getUser: (jwt?: string) => Promise<{
      data: {
        user: Pick<User, "id" | "email"> | null;
      };
      error: unknown;
    }>;
  };
};

export type AuthenticatedUser = {
  id: User["id"];
  email?: User["email"];
};

export function getBearerToken(request: Request): string {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();

  if (!token) {
    throw new UserVisibleError("Bitte zuerst anmelden.", 401);
  }

  return token;
}

export async function authenticateSupabaseRequest(
  request: Request,
  supabase: SupabaseAuthClient,
): Promise<AuthenticatedUser> {
  const token = getBearerToken(request);
  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user?.id) {
    throw new UserVisibleError("Deine Anmeldung ist abgelaufen. Bitte erneut anmelden.", 401);
  }

  return {
    id: data.user.id,
    email: data.user.email,
  };
}
