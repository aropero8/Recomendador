import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  worker: { format: "es" },
  // La API de MyAnimeList y el RSS de Letterboxd no admiten CORS: en desarrollo se piden a través de Vite
  server: {
    proxy: {
      "/mal-api": {
        target: "https://api.myanimelist.net",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/mal-api/, ""),
      },
      "/lb-rss": {
        target: "https://letterboxd.com",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/lb-rss/, ""),
      },
    },
  },
  build: { target: "es2022" },
});
