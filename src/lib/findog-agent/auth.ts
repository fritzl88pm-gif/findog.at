import { isAdminUser } from "../admin-auth";
import { authenticateSupabaseRequest, type AuthenticatedUser } from "../auth/server";
import { UserVisibleError } from "../errors";

type FindogAgentAuthClient = {
  auth: Parameters<typeof authenticateSupabaseRequest>[1]["auth"];
  from: Parameters<typeof isAdminUser>[0]["from"];
};

/**
 * Shared HTTP boundary for every Findog Agent admin route. It authenticates the
 * bearer token first and then re-checks administrator membership against the
 * current registry, so revoked administrators lose access immediately.
 */
export async function authenticateFindogAgentAdmin(
  request: Request,
  supabase: FindogAgentAuthClient,
): Promise<AuthenticatedUser> {
  const user = await authenticateSupabaseRequest(request, supabase);

  if (!await isAdminUser(supabase, user.id)) {
    throw new UserVisibleError("Du hast keine Administrationsberechtigung.", 403);
  }

  return user;
}
