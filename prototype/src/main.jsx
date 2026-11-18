import React from "react";
import { createRoot } from "react-dom/client";
import { Root } from "./Root.jsx";
import "./styles.css";
import "./overlays.css";
import "./settings.css";
import "./operations.css";
import "./cards.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
