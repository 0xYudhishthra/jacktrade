// Hackathon addition (ETHGlobal Mumbai 2026): which exchange positions were placed by Grok through the connector.
// Positions and trades elsewhere in the app match on positionId to show a "via Grok" badge.
import { useMemo } from "react";
import { usePolledData } from "@/hooks/useBackendAccount";
import { getBets } from "./api.js";

const loadBets = () => getBets(200);

export function useGrokBets(interval = 15_000) {
  return usePolledData("grok-bets", loadBets, interval);
}

/** Set of position ids (strings) that Grok opened. Empty while loading or if the connector is unreachable. */
export function useGrokPositionIds() {
  const { data } = useGrokBets();
  return useMemo(
    () => new Set((data ?? []).filter((b) => b?.positionId != null).map((b) => String(b.positionId))),
    [data],
  );
}

/** The position id of a row from the exchange UI (open positions use `id`; history and activity carry `positionId`). */
export const positionIdOf = (row) => String(row?.positionId ?? row?.id ?? "");
