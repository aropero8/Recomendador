import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  worker: { format: "es" },
  // La API de MyAnimeList no admite CORS: en desarrollo la pedimos a través de Vite
  server: {
    proxy: {
      "/mal-api": {
        target: "https://api.myanimelist.net",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/mal-api/, ""),
      },
    },
  },
  build: { target: "es2022" },
});
