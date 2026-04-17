declare module "proper-lockfile" {
  export interface LockOptions {
    realpath?: boolean;
    retries?: number;
    lockfilePath?: string;
  }

  export type ReleaseFn = () => Promise<void>;

  export function lock(file: string, options?: LockOptions): Promise<ReleaseFn>;

  const lockfile: {
    lock: typeof lock;
  };

  export default lockfile;
}
