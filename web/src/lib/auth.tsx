import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  AuthContext,
  type Account,
  type AuthStatus,
  type AuthValue,
} from "./auth-context";

async function fetchMe(): Promise<{
  account: Account | null;
  oauthEnabled: boolean;
}> {
  const [meRes, configRes] = await Promise.all([
    fetch("/api/me", { credentials: "include" }),
    fetch("/api/config", { credentials: "include" }),
  ]);

  let oauthEnabled = false;
  if (configRes.ok) {
    const config = (await configRes.json()) as { oauthEnabled?: boolean };
    oauthEnabled = Boolean(config.oauthEnabled);
  }

  if (!oauthEnabled) return { account: null, oauthEnabled: false };

  if (!meRes.ok) return { account: null, oauthEnabled: true };
  const data = (await meRes.json()) as { account?: Account | null };
  return { account: data.account ?? null, oauthEnabled: true };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [account, setAccount] = useState<Account | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const params = new URLSearchParams(window.location.hash.split("?")[1] || "");
        const authError = params.get("authError");
        if (authError) setError(authError);

        const { account: next, oauthEnabled } = await fetchMe();
        if (cancelled) return;
        if (!oauthEnabled) {
          setAccount(null);
          setStatus("unconfigured");
          return;
        }
        setAccount(next);
        setStatus(next ? "signed-in" : "signed-out");
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message);
          setStatus("signed-out");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback((returnTo?: string) => {
    const dest = returnTo || `${window.location.pathname}${window.location.hash}` || "/#/starred";
    const url = new URL("/api/auth/google", window.location.origin);
    url.searchParams.set("returnTo", dest);
    window.location.assign(url.toString());
  }, []);

  const signOut = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } finally {
      setAccount(null);
      setStatus("signed-out");
    }
  }, []);

  const value = useMemo<AuthValue>(
    () => ({ status, account, error, signIn, signOut }),
    [status, account, error, signIn, signOut],
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}
