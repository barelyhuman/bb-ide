import type { ThreadEvent } from "@bb/domain";
import type {
  EnsureProviderTurnStartedArgs,
  ProviderTurnState,
  ProviderTurnStateRegistry,
} from "./turn-state.js";

export interface BuildScopedProviderErrorEventsArgs<
  TState extends ProviderTurnState,
> {
  contextThreadId?: string;
  detail: string;
  ensureTurnStarted: (args: EnsureProviderTurnStartedArgs<TState>) => string;
  registry: ProviderTurnStateRegistry<TState>;
}

export function buildScopedProviderErrorEvents<
  TState extends ProviderTurnState,
>(args: BuildScopedProviderErrorEventsArgs<TState>): ThreadEvent[] {
  const events: ThreadEvent[] = [];
  const stateKey = args.contextThreadId;
  const state = stateKey
    ? args.registry.getOrCreate({ threadId: stateKey })
    : null;
  const turnId = state
    ? args.ensureTurnStarted({
        events,
        state,
        threadId: "",
      })
    : undefined;

  events.push({
    type: "error",
    threadId: "",
    providerThreadId: "",
    ...(turnId ? { turnId } : {}),
    message: "Provider error",
    detail: args.detail,
  });

  if (stateKey && state && turnId) {
    events.push({
      type: "turn/completed",
      threadId: "",
      providerThreadId: "",
      turnId,
      status: "failed",
    });
    args.registry.finishTurn({ state, threadId: stateKey });
  }

  return events;
}
