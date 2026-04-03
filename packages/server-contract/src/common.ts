export type { EmptyInput, Endpoint, Untyped } from "@bb/hono-typed-routes";

export type PathId = { param: { id: string } };
export type PathProjectId = { param: { id: string } };
export type PathProjectAutomationId = { param: { id: string; automationId: string } };
export type PathThreadAndDraft = { param: { id: string; draftId: string } };
