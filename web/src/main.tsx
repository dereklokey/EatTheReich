import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/app/App";
import { EffectsProvider } from "@/effects/EffectsContext";
import { SoundProvider } from "@/effects/SoundContext";
import { GoDiceProvider } from "@/godice/GoDiceContext";
import "@/styles/index.css";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");

createRoot(root).render(
  <StrictMode>
    <EffectsProvider>
      <SoundProvider>
        <GoDiceProvider>
          <App />
        </GoDiceProvider>
      </SoundProvider>
    </EffectsProvider>
  </StrictMode>,
);
