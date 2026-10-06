import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.recomendador.app",
  appName: "Recomendador",
  webDir: "dist",
  // Con esto, fetch() pasa por el motor HTTP nativo y no hay problemas de CORS en Android
  plugins: { CapacitorHttp: { enabled: true } },
};

export default config;
