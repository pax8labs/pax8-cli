export interface BulkOp<T = unknown> {
  id: string;
  execute: () => Promise<T>;
}

export interface BulkResult<T> {
  succeeded: Array<{ id: string; result: T }>;
  failed: Array<{ id: string; error: Error }>;
  total: number;
  successCount: number;
  failureCount: number;
}

export async function executeBulk<T>(
  operations: BulkOp<T>[],
  options?: {
    concurrency?: number; // default 5, max 10
    onProgress?: (completed: number, total: number, current: BulkOp<T>) => void;
  },
): Promise<BulkResult<T>> {
  const concurrency = Math.min(Math.max(options?.concurrency ?? 5, 1), 10);
  const total = operations.length;
  const succeeded: BulkResult<T>["succeeded"] = [];
  const failed: BulkResult<T>["failed"] = [];

  if (total === 0) {
    return { succeeded, failed, total: 0, successCount: 0, failureCount: 0 };
  }

  let completed = 0;
  let index = 0;

  async function runNext(): Promise<void> {
    while (index < total) {
      const currentIndex = index++;
      const op = operations[currentIndex];
      try {
        const result = await op.execute();
        succeeded.push({ id: op.id, result });
      } catch (err) {
        failed.push({ id: op.id, error: err instanceof Error ? err : new Error(String(err)) });
      }
      completed++;
      options?.onProgress?.(completed, total, op);
    }
  }

  // Launch up to `concurrency` workers
  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(concurrency, total); i++) {
    workers.push(runNext());
  }
  await Promise.all(workers);

  return {
    succeeded,
    failed,
    total,
    successCount: succeeded.length,
    failureCount: failed.length,
  };
}
