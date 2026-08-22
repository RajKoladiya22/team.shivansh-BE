class IdempotencyCache {
  private cache = new Map<string, number>();
  private readonly defaultTtlMs = 60 * 60 * 1000; // 1 hour

  constructor() {
    // Run cleanup every 15 minutes to prevent memory leak
    setInterval(() => this.cleanup(), 15 * 60 * 1000);
  }

  /**
   * Attempts to acquire an idempotency lock for a key.
   * Returns true if acquired (first time), false if already locked/processed.
   */
  public acquire(key: string, ttlMs: number = this.defaultTtlMs): boolean {
    const now = Date.now();
    const expiry = this.cache.get(key);

    if (expiry && expiry > now) {
      return false; // Already processed/active
    }

    this.cache.set(key, now + ttlMs);
    return true;
  }

  public has(key: string): boolean {
    const now = Date.now();
    const expiry = this.cache.get(key);
    if (!expiry) return false;
    if (expiry <= now) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  public release(key: string): void {
    this.cache.delete(key);
  }

  public clear(): void {
    this.cache.clear();
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, expiry] of this.cache.entries()) {
      if (expiry <= now) {
        this.cache.delete(key);
      }
    }
  }
}

export const idempotencyCache = new IdempotencyCache();
