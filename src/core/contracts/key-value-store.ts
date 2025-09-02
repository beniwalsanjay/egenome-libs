import type { Result } from '../result';
import type { StoreError } from '../errors';

/**
 * Options for setting values in the store
 */
export interface SetOptions {
  /** Time-to-live in milliseconds */
  ttlMs?: number;
  /** Whether to overwrite existing values */
  overwrite?: boolean;
}

/**
 * Options for getting values from the store
 */
export interface GetOptions {
  /** Whether to update TTL on access */
  refreshTtl?: boolean;
  /** Default value to return if key doesn't exist */
  defaultValue?: unknown;
}

/**
 * Metadata about a stored value
 */
export interface ValueMetadata {
  /** When the value was created (timestamp) */
  createdAt: number;
  /** When the value was last accessed (timestamp) */
  lastAccessedAt: number;
  /** When the value expires (timestamp), undefined if no expiration */
  expiresAt?: number;
  /** Size of the value in bytes */
  sizeBytes: number;
  /** Number of times the value has been accessed */
  accessCount: number;
}

/**
 * Stored value with metadata
 */
export interface StoredValue<V> {
  value: V;
  metadata: ValueMetadata;
}

/**
 * Batch operation for setting multiple key-value pairs
 */
export interface BatchSetOperation<V> {
  key: string;
  value: V;
  options?: SetOptions;
}

/**
 * Result of a batch operation
 */
export interface BatchResult<T> {
  successful: T[];
  failed: Array<{ key: string; error: StoreError }>;
}

/**
 * Store statistics
 */
export interface StoreStats {
  /** Total number of keys */
  keyCount: number;
  /** Total memory usage in bytes */
  memoryUsageBytes: number;
  /** Number of cache hits */
  hits: number;
  /** Number of cache misses */
  misses: number;
  /** Hit ratio (hits / (hits + misses)) */
  hitRatio: number;
  /** Number of evicted items */
  evictions: number;
  /** Number of expired items */
  expirations: number;
}

/**
 * Enhanced IKeyValueStore interface with comprehensive caching features
 * 
 * This interface demonstrates SOLID principles:
 * - Single Responsibility: focused on key/value persistence with caching features
 * - Open/Closed: extensible for new implementations (Redis, DynamoDB, etc.)
 * - Liskov: all implementations must respect the same contract
 * - Interface Segregation: comprehensive but focused interface
 * - Dependency Inversion: depend on abstraction, not concrete implementations
 */
export interface IKeyValueStore<V = unknown> {
  // Core operations
  /**
   * Retrieves a value by key
   */
  get(key: string, options?: GetOptions): Promise<Result<V | undefined, StoreError>>;

  /**
   * Stores a value with the given key
   */
  set(key: string, value: V, options?: SetOptions): Promise<Result<void, StoreError>>;

  /**
   * Checks if a key exists in the store
   */
  has(key: string): Promise<Result<boolean, StoreError>>;

  /**
   * Deletes a value by key
   */
  delete(key: string): Promise<Result<boolean, StoreError>>;

  /**
   * Clears all values from the store
   */
  clear(): Promise<Result<void, StoreError>>;

  // Batch operations
  /**
   * Retrieves multiple values by keys
   */
  mget(keys: string[], options?: GetOptions): Promise<Result<Map<string, V>, StoreError>>;

  /**
   * Sets multiple key-value pairs
   */
  mset(operations: BatchSetOperation<V>[]): Promise<Result<BatchResult<string>, StoreError>>;

  /**
   * Deletes multiple keys
   */
  mdel(keys: string[]): Promise<Result<BatchResult<string>, StoreError>>;

  // Advanced operations
  /**
   * Gets a value with its metadata
   */
  getWithMetadata(key: string): Promise<Result<StoredValue<V> | undefined, StoreError>>;

  /**
   * Updates the TTL of an existing key
   */
  updateTtl(key: string, ttlMs: number): Promise<Result<boolean, StoreError>>;

  /**
   * Gets the remaining TTL for a key
   */
  getTtl(key: string): Promise<Result<number | undefined, StoreError>>;

  /**
   * Lists all keys (use with caution on large stores)
   */
  keys(pattern?: string): Promise<Result<string[], StoreError>>;

  /**
   * Gets the size of a value in bytes
   */
  sizeof(key: string): Promise<Result<number | undefined, StoreError>>;

  // Store management
  /**
   * Gets store statistics
   */
  getStats(): Promise<Result<StoreStats, StoreError>>;

  /**
   * Clears expired items (manual cleanup)
   */
  cleanup(): Promise<Result<number, StoreError>>;

  /**
   * Checks the health of the store
   */
  ping(): Promise<Result<boolean, StoreError>>;
}

/**
 * Extended interface for stores that support eviction policies
 */
export interface IEvictableStore<V = unknown> extends IKeyValueStore<V> {
  /**
   * Evicts items based on the configured policy
   */
  evict(count?: number): Promise<Result<string[], StoreError>>;

  /**
   * Gets the least recently used keys
   */
  getLruKeys(count: number): Promise<Result<string[], StoreError>>;

  /**
   * Gets the least frequently used keys
   */
  getLfuKeys(count: number): Promise<Result<string[], StoreError>>;
}

/**
 * Interface for stores that support transactions
 */
export interface ITransactionalStore<V = unknown> extends IKeyValueStore<V> {
  /**
   * Executes operations in a transaction
   */
  transaction<T>(operations: (store: IKeyValueStore<V>) => Promise<T>): Promise<Result<T, StoreError>>;
}

/**
 * Interface for stores that support pub/sub notifications
 */
export interface IObservableStore<V = unknown> extends IKeyValueStore<V> {
  /**
   * Subscribes to changes for a key pattern
   */
  subscribe(pattern: string, callback: (event: StoreEvent<V>) => void): Promise<Result<string, StoreError>>;

  /**
   * Unsubscribes from changes
   */
  unsubscribe(subscriptionId: string): Promise<Result<boolean, StoreError>>;
}

/**
 * Store event for pub/sub notifications
 */
export interface StoreEvent<V> {
  type: 'set' | 'delete' | 'expire';
  key: string;
  value?: V;
  timestamp: number;
}