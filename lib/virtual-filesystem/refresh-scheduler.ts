export interface RefreshSchedulerOptions {
  minIntervalMs?: number;
  maxDelayMs?: number;
}

export interface RefreshScheduler<TDetail = unknown> {
  schedule: (detail?: TDetail) => void;
  dispose: () => void;
}

export function createRefreshScheduler<TDetail = unknown>(
  run: (detail?: TDetail) => Promise<void>,
  options: RefreshSchedulerOptions = {},
): RefreshScheduler<TDetail> {
  const minIntervalMs = options.minIntervalMs ?? 1000;
  const maxDelayMs = options.maxDelayMs ?? 5000;
  let lastRunAt = 0;
  let inFlight = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingDetail: TDetail | undefined;

  const execute = async () => {
    if (inFlight) return;
    inFlight = true;
    const detail = pendingDetail;
    pendingDetail = undefined;
    try {
      await run(detail);
    } finally {
      inFlight = false;
      lastRunAt = Date.now();
      if (pendingDetail !== undefined) {
        schedule(pendingDetail);
      }
    }
  };

  const schedule = (detail?: TDetail) => {
    pendingDetail = detail ?? pendingDetail;
    if (timer || inFlight) return;
    const now = Date.now();
    const elapsed = now - lastRunAt;
    const delay = Math.min(
      Math.max(0, minIntervalMs - elapsed),
      maxDelayMs,
    );
    timer = setTimeout(() => {
      timer = null;
      void execute();
    }, delay);
  };

  const dispose = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    pendingDetail = undefined;
  };

  return { schedule, dispose };
}
