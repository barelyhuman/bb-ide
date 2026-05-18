import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { AppToaster } from "./components/AppToaster";
import { initializePreferredTheme } from "./hooks/useTheme";
import { createAppQueryClient } from "./lib/query-client";
import "./app.css";

const queryClient = createAppQueryClient();

initializePreferredTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
      <AppToaster position="bottom-right" />
    </QueryClientProvider>
  </StrictMode>,
);
