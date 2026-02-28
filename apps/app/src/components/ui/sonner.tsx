import { Toaster as Sonner, type ToasterProps } from "sonner";
import { usePreferredTheme } from "@/hooks/useTheme";

export function Toaster(props: ToasterProps) {
  const theme = usePreferredTheme();

  return <Sonner theme={theme} {...props} />;
}
