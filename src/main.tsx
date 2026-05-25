import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import './App.css' // или './App.css', смотря где вы написали @import "tailwindcss"

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
