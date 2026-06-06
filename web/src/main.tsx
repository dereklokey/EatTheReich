import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/app/App";
import { EffectsProvider } from "@/effects/EffectsContext";
import "@/styles/index.css";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");

createRoot(root).render(
  <StrictMode>
    <EffectsProvider>
      <App />
    </EffectsProvider>
  </StrictMode>,
);
