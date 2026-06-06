import {
  getEnvironmentOperation,
  type DbQueryConnection,
  type EnvironmentOperationRow,
} from "@bb/db";
import {
  isActiveLifecycleOperationState,
  type EnvironmentOperationKind,
} from "@bb/domain";

export type EnvironmentProvisionOperationKind = Extract<
  EnvironmentOperationKind,
  "provision" | "reprovision"
>;

export type ActiveEnvironmentProvisionOperation = EnvironmentOperationRow & {
  kind: EnvironmentProvisionOperationKind;
};

interface EnvironmentProvisionOperationReadDeps {
  db: DbQueryConnection;
}

const environmentProvisionOperationKinds: readonly EnvironmentProvisionOperationKind[] =
  ["reprovision", "provision"];

export function getActiveEnvironmentProvisionOperation(
  deps: EnvironmentProvisionOperationReadDeps,
  environmentId: string,
): ActiveEnvironmentProvisionOperation | null {
  for (const kind of environmentProvisionOperationKinds) {
    const operation = getEnvironmentOperation(deps.db, {
      environmentId,
      kind,
    });
    if (operation && isActiveLifecycleOperationState(operation.state)) {
      return {
        ...operation,
        kind,
      };
    }
  }

  return null;
}
