import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

/* Fonts are bundled, not fetched: Retr0Vault must render offline. */
import "@fontsource-variable/newsreader";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";

import "./styles/tokens.css";
import "./styles/global.css";

import { App } from "./App";

const container = document.querySelector("#root");

if (!container) {
  throw new Error("Retr0Vault could not find its #root mount point.");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
