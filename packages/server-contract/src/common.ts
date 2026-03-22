export type Endpoint<
  Input,
  Output = unknown,
  Status extends number = 200,
  Format extends "json" | "text" = "json",
> = {
  input: Input;
  output: Output;
  outputFormat: Format;
  status: Status;
};

export type EmptyInput = Record<never, never>;
export type PathId = { param: { id: string } };
export type PathProjectId = { param: { id: string } };
export type PathThreadAndQueued = { param: { id: string; queuedMessageId: string } };
