import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { LoginInput, RegisterInput, RoleName } from "@sdc/shared";
import { api, refreshSession, setAccessToken } from "@/services/api";

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  role: RoleName;
  permissions: string[];
  patientId: string | null;
  doctorId: string | null;
}

interface AuthCtx {
  user: SessionUser | null;
  ready: boolean;
  login: (input: LoginInput) => Promise<SessionUser>;
  register: (input: RegisterInput) => Promise<SessionUser>;
  logout: () => Promise<void>;
  can: (permission: string) => boolean;
}

const Ctx = createContext<AuthCtx | null>(null);
type AuthResponse = { data: { accessToken: string; user: SessionUser } };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);
  const qc = useQueryClient();

  useEffect(() => {
    refreshSession()
      .then(async (ok) => { if (ok) setUser((await api<{ data: SessionUser }>("/auth/me")).data); })
      .catch(() => setUser(null))
      .finally(() => setReady(true));
  }, []);

  const accept = useCallback((r: AuthResponse) => { setAccessToken(r.data.accessToken); setUser(r.data.user); return r.data.user; }, []);

  const value = useMemo<AuthCtx>(() => ({
    user,
    ready,
    login: (body) => api<AuthResponse>("/auth/login", { method: "POST", body }).then(accept),
    register: (body) => api<AuthResponse>("/auth/register", { method: "POST", body }).then(accept),
    logout: async () => {
      await api("/auth/logout", { method: "POST" }).catch(() => undefined);
      setAccessToken(null);
      setUser(null);
      qc.clear();
    },
    can: (p) => !!user?.permissions.includes(p),
  }), [user, ready, accept, qc]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be used inside AuthProvider");
  return c;
}
