import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";

import {
  adminUsersErrorResponse,
  authenticateAdminRequest,
  managedUserSummary,
  parseManagedUserInput,
} from "@/lib/admin-users";
import { UserVisibleError } from "@/lib/errors";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function serverClient() {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    throw new UserVisibleError("Benutzerverwaltung ist derzeit nicht verfügbar.", 503);
  }
  return supabase;
}

export async function GET(request: Request) {
  try {
    const supabase = serverClient();
    await authenticateAdminRequest(request, supabase);

    const users: User[] = [];
    let page: number | null = 1;
    while (page !== null) {
      const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1_000 });
      if (error) {
        throw new UserVisibleError("Benutzer konnten nicht geladen werden.", 503);
      }
      users.push(...data.users);
      page = data.nextPage ?? null;
    }

    return NextResponse.json({
      users: users
        .map(managedUserSummary)
        .sort((left, right) => left.email.localeCompare(right.email, "de")),
    });
  } catch (error) {
    return adminUsersErrorResponse(error, "Benutzer konnten nicht geladen werden.");
  }
}

export async function POST(request: Request) {
  try {
    const supabase = serverClient();
    await authenticateAdminRequest(request, supabase);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new UserVisibleError("Die Anfrage enthält kein gültiges JSON.", 400);
    }
    const input = parseManagedUserInput(body);
    const { data, error } = await supabase.auth.admin.createUser({
      email: input.email,
      password: input.password,
      email_confirm: true,
    });
    if (error || !data.user) {
      throw new UserVisibleError("Das Benutzerkonto konnte nicht erstellt werden.", 400);
    }

    return NextResponse.json({ user: managedUserSummary(data.user) }, { status: 201 });
  } catch (error) {
    return adminUsersErrorResponse(error, "Das Benutzerkonto konnte nicht erstellt werden.");
  }
}
