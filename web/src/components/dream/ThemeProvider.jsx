import { createContext, useContext, useEffect } from 'react';

// JackTrade only ships the dark theme. The context stays so components (charts) can keep asking for it.
const ThemeContext = createContext({ theme: 'dark', setTheme: () => {} });
const VALUE = { theme: 'dark', setTheme: () => {} };

export function ThemeProvider({ children }) {
  useEffect(() => { document.documentElement.dataset.theme = 'dark'; }, []);
  return <ThemeContext.Provider value={VALUE}>{children}</ThemeContext.Provider>;
}

export function useTheme() { return useContext(ThemeContext); }

/** Kept for existing imports; there is no light theme to switch to. */
export function ThemeToggle() { return null; }
