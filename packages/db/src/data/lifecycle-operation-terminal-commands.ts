import { and, eq, inArray } from "drizzle-orm";
import { activeLifecycleOperationStates } from "@bb/domain";
import type { DbConnection, DbTransaction } from "../connection.js";
import {
  environmentOperations,
  hostDaemonCommands,
  hostOperations,
  projectOperations,
  threadOperations,
} from "../schema.js";
import type { HostDaemonCommandRow } from "./commands.js";

type LifecycleOperationTerminalCommandConnection =
  | DbConnection
  | DbTransaction;
type LifecycleOperationTable =
  | typeof environmentOperations
  | typeof hostOperations
  | typeof projectOperations
  | typeof threadOperations;

const terminalCommandStates = ["success", "error"] as const;

export type LifecycleOperationOwner =
  | "environment"
  | "host"
  | "project"
  | "thread";

export interface ActiveLifecycleOperationTerminalCommand {
  command: HostDaemonCommandRow;
  operationId: string;
  owner: LifecycleOperationOwner;
}

interface ListLifecycleOperationTerminalCommandsArgs {
  commandIdColumn: LifecycleOperationTable["commandId"];
  db: LifecycleOperationTerminalCommandConnection;
  operationIdColumn: LifecycleOperationTable["id"];
  owner: LifecycleOperationOwner;
  table: LifecycleOperationTable;
}

interface LifecycleOperationTerminalCommandOwnerConfig {
  commandIdColumn: LifecycleOperationTable["commandId"];
  operationIdColumn: LifecycleOperationTable["id"];
  owner: LifecycleOperationOwner;
  table: LifecycleOperationTable;
}

const lifecycleOperationTerminalCommandOwners = [
  {
    commandIdColumn: environmentOperations.commandId,
    operationIdColumn: environmentOperations.id,
    owner: "environment",
    table: environmentOperations,
  },
  {
    commandIdColumn: hostOperations.commandId,
    operationIdColumn: hostOperations.id,
    owner: "host",
    table: hostOperations,
  },
  {
    commandIdColumn: projectOperations.commandId,
    operationIdColumn: projectOperations.id,
    owner: "project",
    table: projectOperations,
  },
  {
    commandIdColumn: threadOperations.commandId,
    operationIdColumn: threadOperations.id,
    owner: "thread",
    table: threadOperations,
  },
] as const satisfies readonly LifecycleOperationTerminalCommandOwnerConfig[];

function listLifecycleOperationTerminalCommands(
  args: ListLifecycleOperationTerminalCommandsArgs,
): ActiveLifecycleOperationTerminalCommand[] {
  const rows = args.db
    .select({
      command: hostDaemonCommands,
      operationId: args.operationIdColumn,
    })
    .from(args.table)
    .innerJoin(hostDaemonCommands, eq(args.commandIdColumn, hostDaemonCommands.id))
    .where(
      and(
        inArray(args.table.state, [...activeLifecycleOperationStates]),
        inArray(hostDaemonCommands.state, [...terminalCommandStates]),
      ),
    )
    .all();

  return rows.map((row) => ({
    command: row.command,
    operationId: row.operationId,
    owner: args.owner,
  }));
}

export function listActiveLifecycleOperationTerminalCommands(
  db: LifecycleOperationTerminalCommandConnection,
): ActiveLifecycleOperationTerminalCommand[] {
  return lifecycleOperationTerminalCommandOwners.flatMap((owner) =>
    listLifecycleOperationTerminalCommands({
      ...owner,
      db,
    }),
  );
}
