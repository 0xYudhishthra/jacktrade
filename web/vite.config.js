import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    dedupe: ["react", "react-dom"],
  },
  server: {
    host: "127.0.0.1",
    port: 8018,
    strictPort: true,
    headers: { "X-JackTrade-Front": "visual-exploration" },
  },
  preview: { host: "127.0.0.1", port: 8018, strictPort: true },
});
