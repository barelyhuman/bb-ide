import { and, eq, gt, or, type AnyColumn } from "drizzle-orm";

export interface OrderedNumberCursor {
  createdAt: number;
  id: string;
  value: number;
}

export interface BuildOrderedNumberCursorFilterArgs {
  after?: OrderedNumberCursor;
  createdAtColumn: AnyColumn<{ data: number }>;
  idColumn: AnyColumn<{ data: string }>;
  valueColumn: AnyColumn<{ data: number }>;
}

export function buildOrderedNumberCursorFilter(
  args: BuildOrderedNumberCursorFilterArgs,
) {
  if (!args.after) {
    return undefined;
  }

  return or(
    gt(args.valueColumn, args.after.value),
    and(
      eq(args.valueColumn, args.after.value),
      gt(args.createdAtColumn, args.after.createdAt),
    ),
    and(
      eq(args.valueColumn, args.after.value),
      eq(args.createdAtColumn, args.after.createdAt),
      gt(args.idColumn, args.after.id),
    ),
  );
}
