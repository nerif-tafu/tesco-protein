import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "./auth-context";
import {
  StarsContext,
  type StarMap,
  type StarsValue,
  type SyncStatus,
} from "./stars-context";

const PUSH_DELAY_MS = 500;

function cacheKey(sub: string) {
  return `perkcal:stars:${sub}`;
}

function sanitize(raw: Record<string, unknown>): StarMap {
  const out: StarMap = {};
  for (const [sku, at] of Object.entries(raw)) {
    if (sku && typeof at === "number" && at > 0) out[sku] = at;
  }
  return out;
}

function loadCached(sub: string): StarMap {
  try {
    const raw = localStorage.getItem(cacheKey(sub));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return sanitize(parsed as Record<string, unknown>);
  } catch {
    return {};
  }
}

function saveCached(sub: string, stars: StarMap) {
  try {
    localStorage.setItem(cacheKey(sub), JSON.stringify(stars));
  } catch {
    // ignore quota errors
  }
}

async function getRemote(): Promise<StarMap> {
  const res = await fetch("/api/stars", { credentials: "include" });
  if (res.status === 401) throw new Error("signed-out");
  if (!res.ok) throw new Error(`Failed to load starred items (${res.status})`);
  const data = (await res.json()) as { stars?: Record<string, unknown> };
  return data.stars ? sanitize(data.stars) : {};
}

async function putRemote(stars: StarMap): Promise<void> {
  const res = await fetch("/api/stars", {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stars }),
  });
  if (res.status === 401) throw new Error("signed-out");
  if (!res.ok) throw new Error(`Failed to save starred items (${res.status})`);
}

export function StarsProvider({ children }: { children: ReactNode }) {
  const { account, status: authStatus, signIn } = useAuth();
  const [stars, setStars] = useState<StarMap>({});
  const [status, setStatus] = useState<SyncStatus>("local");
  const pushTimer = useRef<number | null>(null);
  const sub = account?.sub ?? null;

  useEffect(() => {
    if (pushTimer.current) {
      window.clearTimeout(pushTimer.current);
      pushTimer.current = null;
    }

    if (!sub) {
      setStars({});
      setStatus("local");
      return;
    }

    let cancelled = false;
    setStars(loadCached(sub));
    setStatus("syncing");
    (async () => {
      try {
        const remote = await getRemote();
        if (cancelled) return;
        setStars(remote);
        saveCached(sub, remote);
        setStatus("synced");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sub]);

  useEffect(() => {
    return () => {
      if (pushTimer.current) window.clearTimeout(pushTimer.current);
    };
  }, []);

  const schedulePush = useCallback(
    (next: StarMap, owner: string) => {
      if (pushTimer.current) window.clearTimeout(pushTimer.current);
      pushTimer.current = window.setTimeout(() => {
        setStatus("syncing");
        putRemote(next)
          .then(() => {
            saveCached(owner, next);
            setStatus("synced");
          })
          .catch(() => setStatus("error"));
      }, PUSH_DELAY_MS);
    },
    [],
  );

  const toggleStar = useCallback(
    (sku: string) => {
      if (!sub) {
        // Starring is account-bound — bounce through Google OAuth first.
        signIn(`${window.location.pathname}${window.location.hash}` || "/#/");
        return;
      }
      setStars((prev) => {
        const next = { ...prev };
        if (next[sku]) delete next[sku];
        else next[sku] = Date.now();
        saveCached(sub, next);
        schedulePush(next, sub);
        return next;
      });
    },
    [schedulePush, signIn, sub],
  );

  const clearStars = useCallback(() => {
    if (!sub) return;
    saveCached(sub, {});
    schedulePush({}, sub);
    setStars({});
  }, [schedulePush, sub]);

  const value = useMemo<StarsValue>(
    () => ({
      stars,
      count: Object.keys(stars).length,
      status: authStatus === "signed-in" ? status : "local",
      isStarred: (sku: string) => Boolean(stars[sku]),
      toggleStar,
      clearStars,
    }),
    [stars, status, authStatus, toggleStar, clearStars],
  );

  return <StarsContext value={value}>{children}</StarsContext>;
}
