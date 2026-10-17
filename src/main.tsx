import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { runGateCheck } from "./gatecheck";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// TEMPORARY: production self-test for the canvas-engine migration.
runGateCheck();
