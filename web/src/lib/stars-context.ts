import { createContext, useContext } from "react";

/** sku → epoch ms the item was starred. */
export type StarMap = Record<string, number>;

export type SyncStatus = "local" | "syncing" | "synced" | "error";

export interface StarsValue {
  stars: StarMap;
  count: number;
  status: SyncStatus;
  isStarred: (sku: string) => boolean;
  toggleStar: (sku: string) => void;
  clearStars: () => void;
}

export const StarsContext = createContext<StarsValue | null>(null);

export function useStars(): StarsValue {
  const ctx = useContext(StarsContext);
  if (!ctx) throw new Error("useStars must be used inside StarsProvider");
  return ctx;
}
