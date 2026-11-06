import { useEffect, useState } from "react";

// useState that remembers the viewer's choice in localStorage, including functional updates.
// Storage can be unavailable (private mode, blocked site data), so reads and writes fall back
// silently.
export function usePersistentState(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const saved = window.localStorage.getItem(key);
      return saved === null ? initial : JSON.parse(saved);
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Not persisted; the choice still applies for this visit.
    }
  }, [key, value]);
  return [value, setValue];
}
