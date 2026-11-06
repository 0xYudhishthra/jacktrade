import { useContext } from "react";
import { TradingSessionContext } from "@/context/TradingSessionContext";

export function useTradingSession() {
  const session = useContext(TradingSessionContext);
  if (!session) throw new Error("Trading session is unavailable");
  return session;
}
