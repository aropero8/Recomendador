import { App as CapApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

// Botón «atrás» de Android: vuelve a la pantalla anterior (ver nav.ts) y solo sale de la app desde el inicio
if (Capacitor.isNativePlatform()) {
  CapApp.addListener("backButton", ({ canGoBack }) => (canGoBack ? history.back() : CapApp.exitApp()));
}

createRoot(document.getElementById("root")!).render(<App />);
