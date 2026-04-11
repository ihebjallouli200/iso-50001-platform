import type { SessionUser } from "./auth_rbac";

export const SESSION_TOKEN_KEY = "enms-session-token";

type LoginResult = {
  sessionToken: string;
  user: {
    id?: number;
    username: string;
    fullName: string;
    role: SessionUser["role"];
  };
  expiresAt?: string;
};

function toSessionUser(data: LoginResult["user"]): SessionUser {
  return {
    username: data.username,
    fullName: data.fullName,
    role: data.role,
  };
}

export async function loginWithApi(username: string, password: string): Promise<{ sessionUser: SessionUser; sessionToken: string } | null> {
  try {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as LoginResult;
    if (!payload?.sessionToken || !payload?.user) {
      return null;
    }

    return {
      sessionUser: toSessionUser(payload.user),
      sessionToken: payload.sessionToken,
    };
  } catch {
    return null;
  }
}

export async function resolveSessionUser(sessionToken: string): Promise<SessionUser | null> {
  try {
    const response = await fetch("/api/auth/meByToken", {
      headers: { "Authorization": `Bearer ${sessionToken}` },
    });
    if (!response.ok) {
      return null;
    }
    const payload = (await response.json()) as { username: string; fullName: string; role: SessionUser["role"] } | null;
    if (!payload) {
      return null;
    }

    return {
      username: payload.username,
      fullName: payload.fullName,
      role: payload.role,
    };
  } catch {
    return null;
  }
}

export async function logoutWithApi(sessionToken: string): Promise<void> {
  try {
    await fetch("/api/auth/logoutByToken", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({ sessionToken }),
    });
  } catch {
  }
}