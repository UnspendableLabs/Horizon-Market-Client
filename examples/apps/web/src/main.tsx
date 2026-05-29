import { Buffer } from "buffer";
(window as any).Buffer = Buffer;
(window as any).global = window;
(window as any).process = { env: {}, browser: true, version: "v20.0.0" };

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./globals.css";
import App from "./App.js";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
