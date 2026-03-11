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
    // Capture pending detail and use null (not undefined) as the sentinel
    const detail = pendingDetail;
    pendingDetail = null; // Use null to indicate "no pending payload"
    try {
      await run(detail);
    } finally {
      inFlight = false;
      lastRunAt = Date.now();
      // Check if a new schedule was requested during execution
      if (pendingDetail !== null) {
        const pending = pendingDetail;
        pendingDetail = null; // Reset before scheduling
        schedule(pending);
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
    pendingDetail = null;
  };

  return { schedule, dispose };
}
