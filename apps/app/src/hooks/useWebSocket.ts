import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createRealtimeCacheEffects } from "./realtime-cache-effects";
import { wsManager } from "../lib/ws";

export { shouldFlushThreadChangesImmediately } from "./realtime-cache-effects";

export function useWebSocket(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const cacheEffects = createRealtimeCacheEffects({ queryClient });
    const unsubscribeConnected = wsManager.onConnected(
      cacheEffects.handleConnected,
    );
    const unsubscribe = wsManager.onChanged(cacheEffects.handleChanged);

    wsManager.connect();
    wsManager.subscribe("thread");
    wsManager.subscribe("project");
    wsManager.subscribe("environment");
    wsManager.subscribe("host");
    wsManager.subscribe("system");

    return () => {
      cacheEffects.dispose();
      unsubscribeConnected();
      unsubscribe();
      wsManager.unsubscribe("thread");
      wsManager.unsubscribe("project");
      wsManager.unsubscribe("environment");
      wsManager.unsubscribe("host");
      wsManager.unsubscribe("system");
    };
  }, [queryClient]);
}
