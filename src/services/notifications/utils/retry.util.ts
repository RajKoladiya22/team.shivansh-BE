export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffFactor?: number;
  isRetryable?: (error: any) => boolean;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  initialDelayMs: 500,
  maxDelayMs: 5000,
  backoffFactor: 2,
  isRetryable: (error: any) => {
    // If Axios error with HTTP status
    if (error?.response?.status) {
      const status = error.response.status;
      // Rate limited
      if (status === 429) return true;
      // Server errors (500, 502, 503, 504)
      if (status >= 500 && status < 600) return true;
      // Client errors (400, 401, 403, 404, etc.) are permanent
      return false;
    }

    // Network level errors (timeouts, DNS, connection reset) are retryable
    const code = error?.code || error?.message;
    if (
      code === "ECONNRESET" ||
      code === "ETIMEDOUT" ||
      code === "ECONNREFUSED" ||
      code === "EAI_AGAIN" ||
      error?.isAxiosError && !error?.response
    ) {
      return true;
    }

    return false;
  },
};

export async function executeWithRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options?: RetryOptions
): Promise<T> {
  const config = { ...DEFAULT_OPTIONS, ...options };
  let lastError: any;
  let delay = config.initialDelayMs;

  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    try {
      return await operation(attempt);
    } catch (err: any) {
      lastError = err;

      const shouldRetry = attempt < config.maxRetries && config.isRetryable(err);
      if (!shouldRetry) {
        throw err;
      }

      // Wait with exponential backoff + jitter
      const jitter = Math.random() * 100;
      await new Promise((resolve) => setTimeout(resolve, delay + jitter));
      delay = Math.min(delay * config.backoffFactor, config.maxDelayMs);
    }
  }

  throw lastError;
}
