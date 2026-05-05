import { createHash } from "node:crypto";
import { HOST_DAEMON_PROTOCOL_VERSION } from "@bb/host-daemon-contract";
import type { DbConnection } from "@bb/db";
import {
  CLIENT_TURN_REQUEST_ID_ALPHABET,
  CLIENT_TURN_REQUEST_ID_SUFFIX_LENGTH,
  canonicalizeProducerEventPayload,
  clientTurnRequestIdSchema,
  formatClientTurnRequestIdSuffix,
  hostDaemonProducerEventIdSchema,
  jsonValueSchema,
  parseStoredThreadEvent,
  threadEventTypeSchema,
  threadScope,
  turnScope,
  type ClientTurnRequestId,
  type HostDaemonProducerEventId,
  type JsonObject,
  type JsonValue,
  type ThreadEventScope,
} from "@bb/domain";
import { z } from "zod";

const HOST_DAEMON_PRODUCER_EVENT_ID_PREFIX = "hdevt_";
const HOST_DAEMON_PRODUCER_EVENT_ID_SUFFIX_LENGTH = 20;
const REQUEST_KEY_SEPARATOR = "\u0000";
const SERVER_OWNED_EVENT_TYPES = new Set<string>([
  "client/thread/start",
  "client/turn/requested",
  "client/turn/start",
]);

const eventRowSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  scopeKind: z.enum(["thread", "turn"]),
  turnId: z.string().nullable(),
  providerThreadId: z.string().nullable(),
  sequence: z.number().int(),
  type: z.string(),
  producerEventId: z.string().nullable(),
  producerEventPayloadHash: z.string().nullable(),
  data: z.string(),
});
type EventRow = z.infer<typeof eventRowSchema>;

const commandRowSchema = z.object({
  id: z.string(),
  type: z.string(),
  state: z.string(),
  payload: z.string(),
});
type CommandRow = z.infer<typeof commandRowSchema>;

const duplicateSequenceRowSchema = z.object({
  threadId: z.string(),
  sequence: z.number().int(),
  count: z.number().int(),
  eventIds: z.string(),
});
type DuplicateSequenceRow = z.infer<typeof duplicateSequenceRowSchema>;

const producerDuplicateRowSchema = z.object({
  producerEventId: z.string(),
  count: z.number().int(),
  eventIds: z.string(),
});
type ProducerDuplicateRow = z.infer<typeof producerDuplicateRowSchema>;

const tableInfoRowSchema = z.object({
  name: z.string(),
});

const oldProtocolCommandStateSchema = z.enum([
  "pending",
  "fetched",
  "success",
  "error",
]);
type OldProtocolCommandState = z.infer<typeof oldProtocolCommandStateSchema>;

export type EventProtocolHardCutoverIssueKind =
  | "duplicate-event-sequence"
  | "duplicate-request-sequence"
  | "duplicate-generated-request-id"
  | "duplicate-producer-event-id"
  | "fetched-old-protocol-command"
  | "invalid-command-event-sequence"
  | "invalid-event-client-request-sequence"
  | "invalid-event-sequence"
  | "invalid-json"
  | "invalid-producer-event-id"
  | "invalid-request-id"
  | "missing-client-request-id"
  | "missing-producer-event-id"
  | "orphan-command-event-sequence"
  | "orphan-event-client-request-sequence"
  | "orphan-event-client-request-id"
  | "unresolved-legacy-command-field"
  | "unresolved-legacy-event-field";

export interface EventProtocolHardCutoverIssue {
  commandId?: string;
  commandState?: OldProtocolCommandState;
  commandType?: string;
  count?: number;
  eventId?: string;
  eventIds?: string[];
  fieldPath?: string;
  kind: EventProtocolHardCutoverIssueKind;
  message: string;
  producerEventId?: string;
  requestId?: string;
  sequence?: number;
  threadId?: string;
}

export interface EventProtocolHardCutoverPreflightReport {
  issueCount: number;
  issues: EventProtocolHardCutoverIssue[];
  legacyCommandCount: number;
  legacyTurnInputAcceptedCount: number;
  legacyUserMessageCount: number;
  requestEventCount: number;
}

export interface EventProtocolHardCutoverMutationReport {
  backfilledClientRequestIds: number;
  backfilledProducerEventIds: number;
  removedTerminalCommandEventSequences: number;
  rewrittenCommands: number;
  rewrittenTurnInputAcceptedEvents: number;
  rewrittenUserMessageItems: number;
  schemaChanges: number;
}

export interface EventProtocolHardCutoverIntegrityReport {
  issueCount: number;
  issues: EventProtocolHardCutoverIssue[];
}

export interface RunEventProtocolHardCutoverMigrationArgs {
  apply: boolean;
  db: DbConnection;
}

export interface EventProtocolHardCutoverMigrationReport {
  integrity: EventProtocolHardCutoverIntegrityReport | null;
  mode: "apply" | "preflight";
  mutation: EventProtocolHardCutoverMutationReport | null;
  preflight: EventProtocolHardCutoverPreflightReport;
}

export class EventProtocolHardCutoverPreflightError extends Error {
  readonly report: EventProtocolHardCutoverPreflightReport;

  constructor(report: EventProtocolHardCutoverPreflightReport) {
    super("Event protocol hard-cutover preflight failed");
    this.name = "EventProtocolHardCutoverPreflightError";
    this.report = report;
  }
}

export class EventProtocolHardCutoverIntegrityError extends Error {
  readonly report: EventProtocolHardCutoverIntegrityReport;

  constructor(report: EventProtocolHardCutoverIntegrityReport) {
    super("Event protocol hard-cutover integrity check failed");
    this.name = "EventProtocolHardCutoverIntegrityError";
    this.report = report;
  }
}

interface RequestEventReference {
  eventId: string;
  requestId: ClientTurnRequestId;
  sequence: number;
  threadId: string;
}

interface RequestEventMaps {
  byRequestId: Map<string, RequestEventReference>;
  byThreadSequence: Map<string, RequestEventReference>;
  duplicateGeneratedRequestIdIssues: EventProtocolHardCutoverIssue[];
}

interface ParsedEventRowData {
  data: JsonObject;
  row: EventRow;
}

interface LegacyFieldPath {
  fieldName: "clientRequestSequence" | "eventSequence";
  path: string;
}

interface LegacyEventPathClassificationArgs {
  data: JsonObject;
  legacyPath: LegacyFieldPath;
  row: EventRow;
}

type LegacyEventPathClassification =
  | {
      fieldPath: "$.clientRequestSequence";
      kind: "turn-input-accepted";
    }
  | {
      fieldPath: "$.item.clientRequestSequence";
      item: JsonObject;
      kind: "user-message-item";
    }
  | {
      fieldPath: string;
      kind: "unsupported";
    };

interface RewriteLegacyEventDataResult {
  data: JsonObject;
  rewroteTurnInputAccepted: boolean;
  rewroteUserMessage: boolean;
}

interface RewriteLegacyCommandPayloadResult {
  payload: JsonObject;
  removedTerminalEventSequence: boolean;
  rewritten: boolean;
}

interface HashToAlphabetSuffixArgs {
  input: string;
  length: number;
}

interface RequestKeyArgs {
  sequence: number;
  threadId: string;
}

interface DeterministicProducerEventIdArgs {
  payloadHash: string;
  row: EventRow;
}

interface UpdateEventDataArgs {
  data: JsonObject;
  eventId: string;
}

interface UpdateCommandPayloadArgs {
  commandId: string;
  payload: JsonObject;
}

interface UpdateProducerIdentityArgs {
  eventId: string;
  payloadHash: string;
  producerEventId: HostDaemonProducerEventId;
}

interface ValidateClientRequestReferenceArgs {
  eventId: string;
  fieldPath: string;
  requestId: string;
  sequence: number;
  threadId: string;
}

interface EventSchemaCapabilities {
  hasProducerEventId: boolean;
  hasProducerEventPayloadHash: boolean;
}

interface ParseEventRowsForPreflightResult {
  issues: EventProtocolHardCutoverIssue[];
  parsedRows: ParsedEventRowData[];
}

interface ValidateLegacyEventReferencesResult {
  issues: EventProtocolHardCutoverIssue[];
  legacyTurnInputAcceptedCount: number;
  legacyUserMessageCount: number;
}

interface ValidateLegacyCommandReferencesResult {
  issues: EventProtocolHardCutoverIssue[];
  legacyCommandCount: number;
}

interface EventProtocolHardCutoverApplyTransactionResult {
  integrity: EventProtocolHardCutoverIntegrityReport;
  mutation: EventProtocolHardCutoverMutationReport;
}

function hashText(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function hashToAlphabetSuffix(args: HashToAlphabetSuffixArgs): string {
  let suffix = "";
  let counter = 0;
  while (suffix.length < args.length) {
    const digest = createHash("sha256")
      .update(`${args.input}:${counter}`)
      .digest();
    for (const byte of digest) {
      if (suffix.length >= args.length) {
        break;
      }
      suffix += CLIENT_TURN_REQUEST_ID_ALPHABET.charAt(
        byte % CLIENT_TURN_REQUEST_ID_ALPHABET.length,
      );
    }
    counter += 1;
  }
  return suffix;
}

function createRequestKey(args: RequestKeyArgs): string {
  return `${args.threadId}${REQUEST_KEY_SEPARATOR}${args.sequence}`;
}

function createDeterministicClientRequestId(
  args: RequestKeyArgs,
): ClientTurnRequestId {
  return formatClientTurnRequestIdSuffix({
    suffix: hashToAlphabetSuffix({
      input: `client-request:${args.threadId}:${args.sequence}`,
      length: CLIENT_TURN_REQUEST_ID_SUFFIX_LENGTH,
    }),
  });
}

function createDeterministicProducerEventId(
  args: DeterministicProducerEventIdArgs,
): HostDaemonProducerEventId {
  const suffix = hashToAlphabetSuffix({
    input: [
      "producer-event",
      args.row.threadId,
      String(args.row.sequence),
      args.row.type,
      args.payloadHash,
    ].join(":"),
    length: HOST_DAEMON_PRODUCER_EVENT_ID_SUFFIX_LENGTH,
  });
  return hostDaemonProducerEventIdSchema.parse(
    `${HOST_DAEMON_PRODUCER_EVENT_ID_PREFIX}${suffix}`,
  );
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isTerminalCommandState(state: OldProtocolCommandState): boolean {
  return state === "success" || state === "error";
}

function parseJsonObject(text: string): JsonObject {
  const value = jsonValueSchema.parse(JSON.parse(text));
  if (!isJsonObject(value)) {
    throw new Error("Expected JSON object");
  }
  return value;
}

function readIntegerField(
  object: JsonObject,
  fieldName: string,
): number | null {
  const value = object[fieldName];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    return null;
  }
  return value;
}

function readStringField(object: JsonObject, fieldName: string): string | null {
  const value = object[fieldName];
  return typeof value === "string" ? value : null;
}

function deleteField(object: JsonObject, fieldName: string): void {
  delete object[fieldName];
}

function collectLegacyFieldPaths(
  value: JsonValue,
  fieldName: "clientRequestSequence" | "eventSequence",
  path = "$",
): LegacyFieldPath[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) =>
      collectLegacyFieldPaths(entry, fieldName, `${path}[${index}]`),
    );
  }
  if (!isJsonObject(value)) {
    return [];
  }

  const paths: LegacyFieldPath[] = [];
  for (const [key, entry] of Object.entries(value)) {
    const entryPath = `${path}.${key}`;
    if (key === fieldName) {
      paths.push({ fieldName, path: entryPath });
    }
    paths.push(...collectLegacyFieldPaths(entry, fieldName, entryPath));
  }
  return paths;
}

function isUserMessageItemEventType(type: string): boolean {
  return type === "item/started" || type === "item/completed";
}

function classifyLegacyEventPath(
  args: LegacyEventPathClassificationArgs,
): LegacyEventPathClassification {
  if (
    args.row.type === "turn/input/accepted" &&
    args.legacyPath.path === "$.clientRequestSequence"
  ) {
    return {
      fieldPath: "$.clientRequestSequence",
      kind: "turn-input-accepted",
    };
  }

  const item = args.data.item;
  if (
    isUserMessageItemEventType(args.row.type) &&
    args.legacyPath.path === "$.item.clientRequestSequence" &&
    isJsonObject(item) &&
    item.type === "userMessage"
  ) {
    return {
      fieldPath: "$.item.clientRequestSequence",
      item,
      kind: "user-message-item",
    };
  }

  return {
    fieldPath: args.legacyPath.path,
    kind: "unsupported",
  };
}

function listEventRows(db: DbConnection): EventRow[] {
  const capabilities = readEventSchemaCapabilities(db);
  const producerEventIdSelect = capabilities.hasProducerEventId
    ? "producer_event_id"
    : "NULL";
  const producerEventPayloadHashSelect =
    capabilities.hasProducerEventPayloadHash
      ? "producer_event_payload_hash"
      : "NULL";

  return z.array(eventRowSchema).parse(
    db.$client
      .prepare(
        `SELECT
          id,
          thread_id AS threadId,
          scope_kind AS scopeKind,
          turn_id AS turnId,
          provider_thread_id AS providerThreadId,
          sequence,
          type,
          ${producerEventIdSelect} AS producerEventId,
          ${producerEventPayloadHashSelect} AS producerEventPayloadHash,
          data
        FROM events
        ORDER BY thread_id, sequence, id`,
      )
      .all(),
  );
}

function listEventRowsMissingProducerIdentity(db: DbConnection): EventRow[] {
  const capabilities = readEventSchemaCapabilities(db);
  if (
    !capabilities.hasProducerEventId ||
    !capabilities.hasProducerEventPayloadHash
  ) {
    return listEventRows(db).filter(
      (row) => isDaemonProducedEvent(row) && row.producerEventId === null,
    );
  }

  return z.array(eventRowSchema).parse(
    db.$client
      .prepare(
        `SELECT
          id,
          thread_id AS threadId,
          scope_kind AS scopeKind,
          turn_id AS turnId,
          provider_thread_id AS providerThreadId,
          sequence,
          type,
          producer_event_id AS producerEventId,
          producer_event_payload_hash AS producerEventPayloadHash,
          data
        FROM events
        WHERE type NOT IN ('client/thread/start', 'client/turn/requested', 'client/turn/start')
          AND producer_event_id IS NULL
        ORDER BY thread_id, sequence, id`,
      )
      .all(),
  );
}

function readEventSchemaCapabilities(
  db: DbConnection,
): EventSchemaCapabilities {
  const rows = z
    .array(tableInfoRowSchema)
    .parse(db.$client.prepare("PRAGMA table_info(events)").all());
  const columnNames = new Set(rows.map((row) => row.name));
  return {
    hasProducerEventId: columnNames.has("producer_event_id"),
    hasProducerEventPayloadHash: columnNames.has("producer_event_payload_hash"),
  };
}

function ensureProducerIdentitySchema(db: DbConnection): number {
  const capabilities = readEventSchemaCapabilities(db);
  let schemaChanges = 0;
  if (!capabilities.hasProducerEventId) {
    db.$client.exec("ALTER TABLE events ADD COLUMN producer_event_id TEXT");
    schemaChanges += 1;
  }
  if (!capabilities.hasProducerEventPayloadHash) {
    db.$client.exec(
      "ALTER TABLE events ADD COLUMN producer_event_payload_hash TEXT",
    );
    schemaChanges += 1;
  }
  db.$client.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS events_producer_event_id_idx ON events(producer_event_id)",
  );
  return schemaChanges;
}

function listCommandRows(db: DbConnection): CommandRow[] {
  return z.array(commandRowSchema).parse(
    db.$client
      .prepare(
        `SELECT id, type, state, payload
        FROM host_daemon_commands
        ORDER BY cursor, id`,
      )
      .all(),
  );
}

function listDuplicateEventSequenceRows(
  db: DbConnection,
): DuplicateSequenceRow[] {
  return z.array(duplicateSequenceRowSchema).parse(
    db.$client
      .prepare(
        `SELECT
          thread_id AS threadId,
          sequence,
          COUNT(*) AS count,
          GROUP_CONCAT(id) AS eventIds
        FROM events
        GROUP BY thread_id, sequence
        HAVING COUNT(*) > 1
        ORDER BY thread_id, sequence`,
      )
      .all(),
  );
}

function listDuplicateRequestSequenceRows(
  db: DbConnection,
): DuplicateSequenceRow[] {
  return z.array(duplicateSequenceRowSchema).parse(
    db.$client
      .prepare(
        `SELECT
          thread_id AS threadId,
          sequence,
          COUNT(*) AS count,
          GROUP_CONCAT(id) AS eventIds
        FROM events
        WHERE type = 'client/turn/requested'
        GROUP BY thread_id, sequence
        HAVING COUNT(*) > 1
        ORDER BY thread_id, sequence`,
      )
      .all(),
  );
}

function listProducerDuplicateRows(db: DbConnection): ProducerDuplicateRow[] {
  return z.array(producerDuplicateRowSchema).parse(
    db.$client
      .prepare(
        `SELECT
          producer_event_id AS producerEventId,
          COUNT(*) AS count,
          GROUP_CONCAT(id) AS eventIds
        FROM events
        WHERE producer_event_id IS NOT NULL
        GROUP BY producer_event_id
        HAVING COUNT(*) > 1
        ORDER BY producer_event_id`,
      )
      .all(),
  );
}

function toEventIds(value: string): string[] {
  return value.length === 0 ? [] : value.split(",");
}

function toScope(row: EventRow): ThreadEventScope {
  if (row.scopeKind === "thread") {
    return threadScope();
  }
  if (row.turnId === null) {
    throw new Error(`Turn-scoped event ${row.id} is missing turn_id`);
  }
  return turnScope(row.turnId);
}

function isDaemonProducedEvent(row: EventRow): boolean {
  return !SERVER_OWNED_EVENT_TYPES.has(row.type);
}

function parseEventRowsForPreflight(
  rows: readonly EventRow[],
): ParseEventRowsForPreflightResult {
  const issues: EventProtocolHardCutoverIssue[] = [];
  const parsedRows: ParsedEventRowData[] = [];
  for (const row of rows) {
    if (row.sequence <= 0) {
      issues.push({
        eventId: row.id,
        kind: "invalid-event-sequence",
        message: `Event ${row.id} has non-positive sequence ${row.sequence}`,
        sequence: row.sequence,
        threadId: row.threadId,
      });
    }
    try {
      parsedRows.push({ row, data: parseJsonObject(row.data) });
    } catch (error) {
      issues.push({
        eventId: row.id,
        kind: "invalid-json",
        message: `Event ${row.id} contains invalid JSON data: ${formatError(error)}`,
        sequence: row.sequence,
        threadId: row.threadId,
      });
    }
  }
  return { issues, parsedRows };
}

function buildRequestEventMaps(
  parsedRows: readonly ParsedEventRowData[],
): RequestEventMaps {
  const byThreadSequence = new Map<string, RequestEventReference>();
  const byRequestId = new Map<string, RequestEventReference>();
  const duplicateGeneratedRequestIdIssues: EventProtocolHardCutoverIssue[] = [];

  for (const { row, data } of parsedRows) {
    if (row.type !== "client/turn/requested") {
      continue;
    }

    const existingRequestId = readStringField(data, "requestId");
    const requestId = existingRequestId
      ? clientTurnRequestIdSchema.parse(existingRequestId)
      : createDeterministicClientRequestId({
          threadId: row.threadId,
          sequence: row.sequence,
        });
    const reference = {
      eventId: row.id,
      requestId,
      sequence: row.sequence,
      threadId: row.threadId,
    };
    byThreadSequence.set(
      createRequestKey({ threadId: row.threadId, sequence: row.sequence }),
      reference,
    );

    const existingReference = byRequestId.get(requestId);
    if (existingReference) {
      duplicateGeneratedRequestIdIssues.push({
        eventId: row.id,
        eventIds: [existingReference.eventId, row.id],
        kind: "duplicate-generated-request-id",
        message: `Client request id ${requestId} is used by multiple request events`,
        requestId,
        sequence: row.sequence,
        threadId: row.threadId,
      });
      continue;
    }
    byRequestId.set(requestId, reference);
  }

  return {
    byRequestId,
    byThreadSequence,
    duplicateGeneratedRequestIdIssues,
  };
}

function getRequestByLegacySequence(
  requestMaps: RequestEventMaps,
  args: RequestKeyArgs,
): RequestEventReference | null {
  return (
    requestMaps.byThreadSequence.get(
      createRequestKey({ threadId: args.threadId, sequence: args.sequence }),
    ) ?? null
  );
}

function pushDuplicateSequenceIssues(
  issues: EventProtocolHardCutoverIssue[],
  rows: readonly DuplicateSequenceRow[],
  kind: "duplicate-event-sequence" | "duplicate-request-sequence",
): void {
  for (const row of rows) {
    issues.push({
      count: row.count,
      eventIds: toEventIds(row.eventIds),
      kind,
      message: `Thread ${row.threadId} has ${row.count} event rows at sequence ${row.sequence}`,
      sequence: row.sequence,
      threadId: row.threadId,
    });
  }
}

function validateLegacyEventReferences(
  parsedRows: readonly ParsedEventRowData[],
  requestMaps: RequestEventMaps,
): ValidateLegacyEventReferencesResult {
  const issues: EventProtocolHardCutoverIssue[] = [];
  let legacyTurnInputAcceptedCount = 0;
  let legacyUserMessageCount = 0;

  for (const { row, data } of parsedRows) {
    const legacyPaths = collectLegacyFieldPaths(data, "clientRequestSequence");
    if (legacyPaths.length === 0) {
      continue;
    }

    for (const legacyPath of legacyPaths) {
      const classification = classifyLegacyEventPath({
        data,
        legacyPath,
        row,
      });
      switch (classification.kind) {
        case "turn-input-accepted": {
          legacyTurnInputAcceptedCount += 1;
          const sequence = readIntegerField(data, "clientRequestSequence");
          if (sequence === null) {
            issues.push({
              eventId: row.id,
              fieldPath: classification.fieldPath,
              kind: "invalid-event-client-request-sequence",
              message: `Event ${row.id} has a non-integer clientRequestSequence`,
              threadId: row.threadId,
            });
          } else if (
            getRequestByLegacySequence(requestMaps, {
              threadId: row.threadId,
              sequence,
            }) === null
          ) {
            issues.push({
              eventId: row.id,
              fieldPath: classification.fieldPath,
              kind: "orphan-event-client-request-sequence",
              message: `Event ${row.id} references missing same-thread request sequence ${sequence}`,
              sequence,
              threadId: row.threadId,
            });
          }
          break;
        }
        case "user-message-item": {
          legacyUserMessageCount += 1;
          const sequence = readIntegerField(
            classification.item,
            "clientRequestSequence",
          );
          if (sequence === null) {
            issues.push({
              eventId: row.id,
              fieldPath: classification.fieldPath,
              kind: "invalid-event-client-request-sequence",
              message: `User-message item in event ${row.id} has a non-integer clientRequestSequence`,
              threadId: row.threadId,
            });
          } else if (
            getRequestByLegacySequence(requestMaps, {
              threadId: row.threadId,
              sequence,
            }) === null
          ) {
            issues.push({
              eventId: row.id,
              fieldPath: classification.fieldPath,
              kind: "orphan-event-client-request-sequence",
              message: `User-message item in event ${row.id} references missing same-thread request sequence ${sequence}`,
              sequence,
              threadId: row.threadId,
            });
          }
          break;
        }
        case "unsupported":
          issues.push({
            eventId: row.id,
            fieldPath: classification.fieldPath,
            kind: "unresolved-legacy-event-field",
            message: `Event ${row.id} has clientRequestSequence at unsupported path ${classification.fieldPath}`,
            threadId: row.threadId,
          });
          break;
      }
    }
  }

  return {
    issues,
    legacyTurnInputAcceptedCount,
    legacyUserMessageCount,
  };
}

function validateLegacyCommandReferences(
  commandRows: readonly CommandRow[],
  requestMaps: RequestEventMaps,
): ValidateLegacyCommandReferencesResult {
  const issues: EventProtocolHardCutoverIssue[] = [];
  let legacyCommandCount = 0;

  for (const row of commandRows) {
    let payload: JsonObject;
    try {
      payload = parseJsonObject(row.payload);
    } catch (error) {
      issues.push({
        commandId: row.id,
        commandType: row.type,
        kind: "invalid-json",
        message: `Command ${row.id} contains invalid JSON payload: ${formatError(error)}`,
      });
      continue;
    }

    const oldProtocolState = oldProtocolCommandStateSchema.parse(row.state);
    const legacyPaths = collectLegacyFieldPaths(payload, "eventSequence");
    if (legacyPaths.length === 0) {
      continue;
    }
    legacyCommandCount += 1;

    if (oldProtocolState === "fetched") {
      issues.push({
        commandId: row.id,
        commandState: oldProtocolState,
        commandType: row.type,
        kind: "fetched-old-protocol-command",
        message: `Fetched command ${row.id} still contains eventSequence and may already be in an old daemon process`,
      });
    }

    const rootEventSequence = readIntegerField(payload, "eventSequence");
    if (
      (row.type === "thread.start" || row.type === "turn.submit") &&
      Object.hasOwn(payload, "eventSequence") &&
      !isTerminalCommandState(oldProtocolState)
    ) {
      const threadId = readStringField(payload, "threadId");
      if (rootEventSequence === null || threadId === null) {
        issues.push({
          commandId: row.id,
          commandState: oldProtocolState,
          commandType: row.type,
          fieldPath: "$.eventSequence",
          kind: "invalid-command-event-sequence",
          message: `Command ${row.id} cannot rekey eventSequence without integer eventSequence and string threadId`,
        });
      } else if (
        getRequestByLegacySequence(requestMaps, {
          threadId,
          sequence: rootEventSequence,
        }) === null
      ) {
        issues.push({
          commandId: row.id,
          commandState: oldProtocolState,
          commandType: row.type,
          fieldPath: "$.eventSequence",
          kind: "orphan-command-event-sequence",
          message: `Command ${row.id} references missing same-thread request sequence ${rootEventSequence}`,
          sequence: rootEventSequence,
          threadId,
        });
      }
    }

    for (const path of legacyPaths) {
      const isKnownRootPath =
        (row.type === "thread.start" || row.type === "turn.submit") &&
        path.path === "$.eventSequence";
      const isKnownProvisionInitiatorPath =
        row.type === "environment.provision" &&
        path.path === "$.initiator.eventSequence";
      if (!isKnownRootPath && !isKnownProvisionInitiatorPath) {
        issues.push({
          commandId: row.id,
          commandState: oldProtocolState,
          commandType: row.type,
          fieldPath: path.path,
          kind: "unresolved-legacy-command-field",
          message: `Command ${row.id} has eventSequence at unsupported path ${path.path}`,
        });
      }
    }
  }

  return { issues, legacyCommandCount };
}

export function runEventProtocolHardCutoverPreflight(
  db: DbConnection,
): EventProtocolHardCutoverPreflightReport {
  const rows = listEventRows(db);
  const parseResult = parseEventRowsForPreflight(rows);
  const requestMaps = buildRequestEventMaps(parseResult.parsedRows);
  const duplicateEventRows = listDuplicateEventSequenceRows(db);
  const duplicateRequestRows = listDuplicateRequestSequenceRows(db);
  const eventReferenceResult = validateLegacyEventReferences(
    parseResult.parsedRows,
    requestMaps,
  );
  const commandReferenceResult = validateLegacyCommandReferences(
    listCommandRows(db),
    requestMaps,
  );

  const issues = [
    ...parseResult.issues,
    ...requestMaps.duplicateGeneratedRequestIdIssues,
    ...eventReferenceResult.issues,
    ...commandReferenceResult.issues,
  ];
  pushDuplicateSequenceIssues(
    issues,
    duplicateEventRows,
    "duplicate-event-sequence",
  );
  pushDuplicateSequenceIssues(
    issues,
    duplicateRequestRows,
    "duplicate-request-sequence",
  );

  return {
    issueCount: issues.length,
    issues,
    legacyCommandCount: commandReferenceResult.legacyCommandCount,
    legacyTurnInputAcceptedCount:
      eventReferenceResult.legacyTurnInputAcceptedCount,
    legacyUserMessageCount: eventReferenceResult.legacyUserMessageCount,
    requestEventCount: requestMaps.byThreadSequence.size,
  };
}

function updateEventData(db: DbConnection, args: UpdateEventDataArgs): void {
  db.$client
    .prepare("UPDATE events SET data = ? WHERE id = ?")
    .run(JSON.stringify(args.data), args.eventId);
}

function updateCommandPayload(
  db: DbConnection,
  args: UpdateCommandPayloadArgs,
): void {
  db.$client
    .prepare("UPDATE host_daemon_commands SET payload = ? WHERE id = ?")
    .run(JSON.stringify(args.payload), args.commandId);
}

function updateProducerIdentity(
  db: DbConnection,
  args: UpdateProducerIdentityArgs,
): void {
  db.$client
    .prepare(
      `UPDATE events
       SET producer_event_id = ?, producer_event_payload_hash = ?
       WHERE id = ?`,
    )
    .run(args.producerEventId, args.payloadHash, args.eventId);
}

function rewriteLegacyEventData(
  parsed: ParsedEventRowData,
  requestMaps: RequestEventMaps,
): RewriteLegacyEventDataResult {
  const data = parsed.data;
  let rewroteTurnInputAccepted = false;
  let rewroteUserMessage = false;

  if (
    parsed.row.type === "turn/input/accepted" &&
    Object.hasOwn(data, "clientRequestSequence")
  ) {
    const sequence = readIntegerField(data, "clientRequestSequence");
    if (sequence === null) {
      throw new Error(
        `Event ${parsed.row.id} has invalid clientRequestSequence`,
      );
    }
    const request = getRequestByLegacySequence(requestMaps, {
      threadId: parsed.row.threadId,
      sequence,
    });
    if (!request) {
      throw new Error(
        `Event ${parsed.row.id} has orphan clientRequestSequence`,
      );
    }
    data.clientRequestId = request.requestId;
    deleteField(data, "clientRequestSequence");
    rewroteTurnInputAccepted = true;
  }

  if (
    (parsed.row.type === "item/started" ||
      parsed.row.type === "item/completed") &&
    isJsonObject(data.item) &&
    data.item.type === "userMessage" &&
    Object.hasOwn(data.item, "clientRequestSequence")
  ) {
    const sequence = readIntegerField(data.item, "clientRequestSequence");
    if (sequence === null) {
      throw new Error(
        `User-message item in event ${parsed.row.id} has invalid clientRequestSequence`,
      );
    }
    const request = getRequestByLegacySequence(requestMaps, {
      threadId: parsed.row.threadId,
      sequence,
    });
    if (!request) {
      throw new Error(
        `User-message item in event ${parsed.row.id} has orphan clientRequestSequence`,
      );
    }
    data.item.clientRequestId = request.requestId;
    deleteField(data.item, "clientRequestSequence");
    rewroteUserMessage = true;
  }

  return { data, rewroteTurnInputAccepted, rewroteUserMessage };
}

function backfillClientRequestId(
  parsed: ParsedEventRowData,
): JsonObject | null {
  if (parsed.row.type !== "client/turn/requested") {
    return null;
  }
  if (readStringField(parsed.data, "requestId") !== null) {
    return null;
  }
  parsed.data.requestId = createDeterministicClientRequestId({
    threadId: parsed.row.threadId,
    sequence: parsed.row.sequence,
  });
  return parsed.data;
}

function rewriteLegacyCommandPayload(
  row: CommandRow,
  requestMaps: RequestEventMaps,
): RewriteLegacyCommandPayloadResult {
  const payload = parseJsonObject(row.payload);
  const oldProtocolState = oldProtocolCommandStateSchema.parse(row.state);
  let removedTerminalEventSequence = false;
  let rewritten = false;

  if (
    (row.type === "thread.start" || row.type === "turn.submit") &&
    Object.hasOwn(payload, "eventSequence")
  ) {
    const sequence = readIntegerField(payload, "eventSequence");
    const threadId = readStringField(payload, "threadId");
    if (
      (sequence === null || threadId === null) &&
      !isTerminalCommandState(oldProtocolState)
    ) {
      throw new Error(`Command ${row.id} has invalid eventSequence`);
    }
    const request =
      sequence === null || threadId === null
        ? null
        : getRequestByLegacySequence(requestMaps, {
            threadId,
            sequence,
          });
    if (!request && !isTerminalCommandState(oldProtocolState)) {
      throw new Error(`Command ${row.id} has orphan eventSequence`);
    }
    if (request) {
      payload.requestId = request.requestId;
    } else {
      removedTerminalEventSequence = true;
    }
    deleteField(payload, "eventSequence");
    rewritten = true;
  }

  if (row.type === "environment.provision" && isJsonObject(payload.initiator)) {
    if (Object.hasOwn(payload.initiator, "eventSequence")) {
      deleteField(payload.initiator, "eventSequence");
      rewritten = true;
    }
  }

  return { payload, removedTerminalEventSequence, rewritten };
}

function computeProducerPayloadHash(row: EventRow): string {
  const type = threadEventTypeSchema.parse(row.type);
  const data = parseJsonObject(row.data);
  const event = parseStoredThreadEvent({
    data,
    providerThreadId: row.providerThreadId,
    scope: toScope(row),
    threadId: row.threadId,
    type,
  });
  return hashText(
    canonicalizeProducerEventPayload({
      event,
      protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
      threadId: row.threadId,
    }),
  );
}

function applyEventProtocolHardCutoverMutation(
  db: DbConnection,
): EventProtocolHardCutoverMutationReport {
  const initialRows = listEventRows(db);
  const parseResult = parseEventRowsForPreflight(initialRows);
  if (parseResult.issues.length > 0) {
    throw new Error("Cannot apply migration with invalid event rows");
  }

  let backfilledClientRequestIds = 0;
  let rewrittenTurnInputAcceptedEvents = 0;
  let rewrittenUserMessageItems = 0;
  let rewrittenCommands = 0;
  let removedTerminalCommandEventSequences = 0;
  let backfilledProducerEventIds = 0;
  const schemaChanges = ensureProducerIdentitySchema(db);

  for (const parsed of parseResult.parsedRows) {
    const backfilledRequestData = backfillClientRequestId(parsed);
    if (backfilledRequestData) {
      updateEventData(db, {
        eventId: parsed.row.id,
        data: backfilledRequestData,
      });
      backfilledClientRequestIds += 1;
    }
  }

  const requestMapsAfterBackfill = buildRequestEventMaps(
    parseResult.parsedRows,
  );

  for (const parsed of parseResult.parsedRows) {
    const rewrite = rewriteLegacyEventData(parsed, requestMapsAfterBackfill);
    if (rewrite.rewroteTurnInputAccepted || rewrite.rewroteUserMessage) {
      updateEventData(db, {
        eventId: parsed.row.id,
        data: rewrite.data,
      });
    }
    if (rewrite.rewroteTurnInputAccepted) {
      rewrittenTurnInputAcceptedEvents += 1;
    }
    if (rewrite.rewroteUserMessage) {
      rewrittenUserMessageItems += 1;
    }
  }

  for (const command of listCommandRows(db)) {
    const rewrite = rewriteLegacyCommandPayload(
      command,
      requestMapsAfterBackfill,
    );
    if (rewrite.rewritten) {
      updateCommandPayload(db, {
        commandId: command.id,
        payload: rewrite.payload,
      });
      rewrittenCommands += 1;
      if (rewrite.removedTerminalEventSequence) {
        removedTerminalCommandEventSequences += 1;
      }
    }
  }

  for (const row of listEventRowsMissingProducerIdentity(db)) {
    const payloadHash = computeProducerPayloadHash(row);
    updateProducerIdentity(db, {
      eventId: row.id,
      payloadHash,
      producerEventId: createDeterministicProducerEventId({
        row,
        payloadHash,
      }),
    });
    backfilledProducerEventIds += 1;
  }

  return {
    backfilledClientRequestIds,
    backfilledProducerEventIds,
    removedTerminalCommandEventSequences,
    rewrittenCommands,
    rewrittenTurnInputAcceptedEvents,
    rewrittenUserMessageItems,
    schemaChanges,
  };
}

function validateClientRequestReference(
  issues: EventProtocolHardCutoverIssue[],
  requestMaps: RequestEventMaps,
  args: ValidateClientRequestReferenceArgs,
): void {
  const parsedRequestId = clientTurnRequestIdSchema.safeParse(args.requestId);
  if (!parsedRequestId.success) {
    issues.push({
      eventId: args.eventId,
      fieldPath: args.fieldPath,
      kind: "invalid-request-id",
      message: `Event ${args.eventId} has invalid clientRequestId`,
      requestId: args.requestId,
      sequence: args.sequence,
      threadId: args.threadId,
    });
    return;
  }

  const request = requestMaps.byRequestId.get(parsedRequestId.data);
  if (!request || request.threadId !== args.threadId) {
    issues.push({
      eventId: args.eventId,
      fieldPath: args.fieldPath,
      kind: "orphan-event-client-request-id",
      message: `Event ${args.eventId} references missing same-thread clientRequestId ${parsedRequestId.data}`,
      requestId: parsedRequestId.data,
      sequence: args.sequence,
      threadId: args.threadId,
    });
  }
}

function validateEventIntegrity(
  issues: EventProtocolHardCutoverIssue[],
  rows: readonly ParsedEventRowData[],
  requestMaps: RequestEventMaps,
): void {
  for (const { row, data } of rows) {
    for (const legacyPath of collectLegacyFieldPaths(
      data,
      "clientRequestSequence",
    )) {
      issues.push({
        eventId: row.id,
        fieldPath: legacyPath.path,
        kind: "unresolved-legacy-event-field",
        message: `Event ${row.id} still contains clientRequestSequence at ${legacyPath.path}`,
        sequence: row.sequence,
        threadId: row.threadId,
      });
    }

    if (row.type === "turn/input/accepted") {
      const requestId = readStringField(data, "clientRequestId");
      if (requestId === null) {
        issues.push({
          eventId: row.id,
          fieldPath: "$.clientRequestId",
          kind: "missing-client-request-id",
          message: `turn/input/accepted event ${row.id} is missing clientRequestId`,
          sequence: row.sequence,
          threadId: row.threadId,
        });
      } else {
        validateClientRequestReference(issues, requestMaps, {
          eventId: row.id,
          fieldPath: "$.clientRequestId",
          requestId,
          sequence: row.sequence,
          threadId: row.threadId,
        });
      }
    }

    if (
      (row.type === "item/started" || row.type === "item/completed") &&
      isJsonObject(data.item) &&
      data.item.type === "userMessage"
    ) {
      const requestId = readStringField(data.item, "clientRequestId");
      if (requestId !== null) {
        validateClientRequestReference(issues, requestMaps, {
          eventId: row.id,
          fieldPath: "$.item.clientRequestId",
          requestId,
          sequence: row.sequence,
          threadId: row.threadId,
        });
      }
    }

    if (!isDaemonProducedEvent(row)) {
      continue;
    }
    if (row.producerEventId === null) {
      issues.push({
        eventId: row.id,
        kind: "missing-producer-event-id",
        message: `Daemon-produced event ${row.id} is missing producerEventId`,
        sequence: row.sequence,
        threadId: row.threadId,
      });
    } else if (
      !hostDaemonProducerEventIdSchema.safeParse(row.producerEventId).success
    ) {
      issues.push({
        eventId: row.id,
        kind: "invalid-producer-event-id",
        message: `Daemon-produced event ${row.id} has invalid producerEventId`,
        producerEventId: row.producerEventId,
        sequence: row.sequence,
        threadId: row.threadId,
      });
    }
  }
}

function validateCommandIntegrity(
  issues: EventProtocolHardCutoverIssue[],
  commandRows: readonly CommandRow[],
  requestMaps: RequestEventMaps,
): void {
  for (const row of commandRows) {
    let payload: JsonObject;
    try {
      payload = parseJsonObject(row.payload);
    } catch (error) {
      issues.push({
        commandId: row.id,
        commandType: row.type,
        kind: "invalid-json",
        message: `Command ${row.id} contains invalid JSON payload: ${formatError(error)}`,
      });
      continue;
    }

    for (const legacyPath of collectLegacyFieldPaths(
      payload,
      "eventSequence",
    )) {
      issues.push({
        commandId: row.id,
        commandType: row.type,
        fieldPath: legacyPath.path,
        kind: "unresolved-legacy-command-field",
        message: `Command ${row.id} still contains eventSequence at ${legacyPath.path}`,
      });
    }

    if (row.type !== "thread.start" && row.type !== "turn.submit") {
      continue;
    }
    const oldProtocolState = oldProtocolCommandStateSchema.parse(row.state);
    if (isTerminalCommandState(oldProtocolState)) {
      continue;
    }
    const requestId = readStringField(payload, "requestId");
    const threadId = readStringField(payload, "threadId");
    if (requestId === null || threadId === null) {
      issues.push({
        commandId: row.id,
        commandType: row.type,
        kind: "missing-client-request-id",
        message: `Command ${row.id} is missing requestId or threadId`,
      });
      continue;
    }
    const parsedRequestId = clientTurnRequestIdSchema.safeParse(requestId);
    if (!parsedRequestId.success) {
      issues.push({
        commandId: row.id,
        commandType: row.type,
        kind: "invalid-request-id",
        message: `Command ${row.id} has invalid requestId`,
        requestId,
        threadId,
      });
      continue;
    }
    const request = requestMaps.byRequestId.get(parsedRequestId.data);
    if (!request || request.threadId !== threadId) {
      issues.push({
        commandId: row.id,
        commandType: row.type,
        kind: "orphan-command-event-sequence",
        message: `Command ${row.id} references missing same-thread requestId ${parsedRequestId.data}`,
        requestId: parsedRequestId.data,
        threadId,
      });
    }
  }
}

export function runEventProtocolHardCutoverIntegrityCheck(
  db: DbConnection,
): EventProtocolHardCutoverIntegrityReport {
  const rows = listEventRows(db);
  const parseResult = parseEventRowsForPreflight(rows);
  const requestMaps = buildRequestEventMaps(parseResult.parsedRows);
  const issues = [
    ...parseResult.issues,
    ...requestMaps.duplicateGeneratedRequestIdIssues,
  ];

  pushDuplicateSequenceIssues(
    issues,
    listDuplicateEventSequenceRows(db),
    "duplicate-event-sequence",
  );
  pushDuplicateSequenceIssues(
    issues,
    listDuplicateRequestSequenceRows(db),
    "duplicate-request-sequence",
  );
  for (const row of listProducerDuplicateRows(db)) {
    issues.push({
      count: row.count,
      eventIds: toEventIds(row.eventIds),
      kind: "duplicate-producer-event-id",
      message: `Producer event id ${row.producerEventId} is used by ${row.count} events`,
      producerEventId: row.producerEventId,
    });
  }

  validateEventIntegrity(issues, parseResult.parsedRows, requestMaps);
  validateCommandIntegrity(issues, listCommandRows(db), requestMaps);

  return {
    issueCount: issues.length,
    issues,
  };
}

export function runEventProtocolHardCutoverMigration(
  args: RunEventProtocolHardCutoverMigrationArgs,
): EventProtocolHardCutoverMigrationReport {
  const preflight = runEventProtocolHardCutoverPreflight(args.db);
  if (preflight.issueCount > 0) {
    throw new EventProtocolHardCutoverPreflightError(preflight);
  }

  if (!args.apply) {
    return {
      integrity: null,
      mode: "preflight",
      mutation: null,
      preflight,
    };
  }

  const migrationResult = args.db.$client.transaction(
    (): EventProtocolHardCutoverApplyTransactionResult => {
      const mutation = applyEventProtocolHardCutoverMutation(args.db);
      const integrity = runEventProtocolHardCutoverIntegrityCheck(args.db);
      if (integrity.issueCount > 0) {
        throw new EventProtocolHardCutoverIntegrityError(integrity);
      }
      return { integrity, mutation };
    },
  )();

  return {
    integrity: migrationResult.integrity,
    mode: "apply",
    mutation: migrationResult.mutation,
    preflight,
  };
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
