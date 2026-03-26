import type { GlobalProvider } from "@ladle/react";
import "../../../apps/app/src/app.css";

export const Provider: GlobalProvider = ({ children }) => {
  return <div className="dark min-h-screen bg-background text-foreground">{children}</div>;
};
