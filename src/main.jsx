import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./index.css";
import "./lib/scout/expose.js"; // console-driven Scout batch runner (no UI yet)

createRoot(document.getElementById("root")).render(<App />);
