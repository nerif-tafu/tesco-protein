import { createContext, useContext } from "react";

export interface Account {
  sub: string;
  email: string | null;
  name: string | null;
  picture: string | null;
}

export type AuthStatus = "loading" | "unconfigured" | "signed-out" | "signed-in";

export interface AuthValue {
  status: AuthStatus;
  account: Account | null;
  error: string | null;
  signIn: (returnTo?: string) => void;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
