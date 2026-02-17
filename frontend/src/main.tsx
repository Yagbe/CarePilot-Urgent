import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { getLanguage, setLanguage } from "./lib/i18n";

// Initialize language on app startup
const lang = getLanguage();
setLanguage(lang);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
