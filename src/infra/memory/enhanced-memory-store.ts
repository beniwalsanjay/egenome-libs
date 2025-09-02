import type { 
  IKeyValueStore, 
  IEvictableStore,
  SetOptions, 
  GetOptions, 
  ValueMetadata, 
  StoredValue, 
  BatchSetOperation, 
  BatchResult, 
  StoreStats 
} from "../../core/contracts/key-value-store";
import type { Result } from "../../core/result";
import { Ok, Err } from "../../core/result";
import { createStoreError, StoreErrorCode } from "../../core/errors";
import type { MemoryStoreConfig } from "../../core/config";
import { getGlobalConfig } from "../../core/config";
import { injectable } from 'inversify';
import 'reflect-metadata';

/**
 * Internal entry structure for stored values
 */
interface InMemoryEntry<V> {
  value: V;
  metadata: ValueMetadata;
}

/**
 * LRU Node for eviction policy
 */
interface LRUNode {
  key: string;
  prev?: LRUNode;
  next?: LRUNode;
}

/**
 * Enhanced InMemoryStore implementation with comprehensive caching features
 * 
 * Features:
 * - TTL support with automatic expiration
 * - LRU eviction policy
 * - Batch operations
 * - Statistics tracking
 * - Memory usage monitoring
 * - Configurable cleanup intervals
 */
@injectable()
export class EnhancedMemoryStore<V = unknown> implements IKeyValueStore<V>, IEvictableStore<V> {
  private readonly map: Map<string, InMemoryEntry<V>> = new Map<string, InMemoryEntry<V>>();
  private readonly lruHead: LRUNode = { key: '__head__' };
  private readonly lruTail: LRUNode = { key: '__tail__' };
  private readonly keyToNode: Map<string, LRUNode> = new Map<string, LRUNode>();
  
  // Statistics
  private stats: {
    keyCount: number;
    memoryUsageBytes: number;
    hits: number;
    misses: number;
    evictions: number;
    expirations: number;
  } = {
    keyCount: 0,
    memoryUsageBytes: 0,
    hits: 0,
    misses: 0,
    evictions: 0,
    expirations: 0
  };

  private cleanupTimer?: NodeJS.Timeout;
  private readonly config: MemoryStoreConfig;

  constructor(config?: Partial<MemoryStoreConfig>) {
    this.config = {
      ...getGlobalConfig().get('stores')?.memory,
      ...config
    };

    // Initialize LRU doubly-linked list
    this.lruHead.next = this.lruTail;
    this.lruTail.prev = this.lruHead;

    // Start automatic cleanup if enabled
    if (this.config.autoCleanup && this.config.cleanupIntervalMs) {
      this.startCleanupTimer();
    }
  }

  /**
   * Retrieves a value by key
   */
  async get(key: string, options?: GetOptions): Promise<Result<V | undefined, any>> {
    try {
      const entry = this.map.get(key);
      
      if (!entry) {
        this.stats.misses++;
        return Ok(options?.defaultValue as V | undefined);
      }

      // Check if expired
      if (this.isExpired(entry)) {
        this.map.delete(key);
        this.removeFromLRU(key);
        this.stats.expirations++;
        this.stats.misses++;
        return Ok(options?.defaultValue as V | undefined);
      }

      // Update access metadata
      const now = Date.now();
      entry.metadata.lastAccessedAt = now;
      entry.metadata.accessCount++;

      if (options?.refreshTtl && entry.metadata.expiresAt) {
        const originalTtl = entry.metadata.expiresAt - entry.metadata.createdAt;
        entry.metadata.expiresAt = now + originalTtl;
      }

      // Update LRU position
      this.moveToHead(key);
      
      this.stats.hits++;
      return Ok(entry.value);
    } catch (error) {
      return Err(createStoreError(`Failed to get key "${key}": ${error}`, StoreErrorCode.OPERATION_FAILED, { key }));
    }
  }

  /**
   * Stores a value with the given key
   */
  async set(key: string, value: V, options?: SetOptions): Promise<Result<void, any>> {
    try {
      const now = Date.now();
      const existing = this.map.get(key);

      // Check overwrite option
      if (existing && options?.overwrite === false) {
        return Err(createStoreError(`Key "${key}" already exists and overwrite is disabled`, StoreErrorCode.OPERATION_FAILED, { key }));
      }

      // Calculate size
      const sizeBytes = this.calculateSize(value);
      
      // Check memory limits
      if (this.config.maxMemoryBytes && 
          (this.stats.memoryUsageBytes + sizeBytes - (existing?.metadata.sizeBytes || 0)) > this.config.maxMemoryBytes) {
        await this.evictToMakeSpace(sizeBytes);
      }

      // Create metadata
      const metadata: ValueMetadata = {
        createdAt: now,
        lastAccessedAt: now,
        expiresAt: options?.ttlMs ? now + options.ttlMs : undefined,
        sizeBytes,
        accessCount: 1
      };

      // Store the entry
      const entry: InMemoryEntry<V> = { value, metadata };
      this.map.set(key, entry);

      // Update LRU
      this.moveToHead(key);

      // Update statistics
      if (!existing) {
        this.stats.keyCount++;
      }
      this.stats.memoryUsageBytes += sizeBytes - (existing?.metadata.sizeBytes || 0);

      return Ok(undefined);
    } catch (error) {
      return Err(createStoreError(`Failed to set key "${key}": ${error}`, StoreErrorCode.OPERATION_FAILED, { key }));
    }
  }

  /**
   * Checks if a key exists in the store
   */
  async has(key: string): Promise<Result<boolean, any>> {
    try {
      const entry = this.map.get(key);
      
      if (!entry) {
        return Ok(false);
      }

      if (this.isExpired(entry)) {
        this.map.delete(key);
        this.removeFromLRU(key);
        this.stats.expirations++;
        return Ok(false);
      }

      return Ok(true);
    } catch (error) {
      return Err(createStoreError(`Failed to check key "${key}": ${error}`, StoreErrorCode.OPERATION_FAILED, { key }));
    }
  }

  /**
   * Deletes a value by key
   */
  async delete(key: string): Promise<Result<boolean, any>> {
    try {
      const entry = this.map.get(key);
      
      if (!entry) {
        return Ok(false);
      }

      this.map.delete(key);
      this.removeFromLRU(key);
      
      this.stats.keyCount--;
      this.stats.memoryUsageBytes -= entry.metadata.sizeBytes;
      
      return Ok(true);
    } catch (error) {
      return Err(createStoreError(`Failed to delete key "${key}": ${error}`, StoreErrorCode.OPERATION_FAILED, { key }));
    }
  }

  /**
   * Clears all values from the store
   */
  async clear(): Promise<Result<void, any>> {
    try {
      this.map.clear();
      this.keyToNode.clear();
      this.lruHead.next = this.lruTail;
      this.lruTail.prev = this.lruHead;
      
      this.stats = {
        keyCount: 0,
        memoryUsageBytes: 0,
        hits: this.stats.hits,
        misses: this.stats.misses,
        evictions: this.stats.evictions,
        expirations: this.stats.expirations
      };
      
      return Ok(undefined);
    } catch (error) {
      return Err(createStoreError(`Failed to clear store: ${error}`, StoreErrorCode.OPERATION_FAILED));
    }
  }

  /**
   * Retrieves multiple values by keys
   */
  async mget(keys: string[], options?: GetOptions): Promise<Result<Map<string, V>, any>> {
    try {
      const result = new Map<string, V>();
      
      for (const key of keys) {
        const getResult = await this.get(key, options);
        if (getResult.ok && getResult.value !== undefined) {
          result.set(key, getResult.value);
        }
      }
      
      return Ok(result);
    } catch (error) {
      return Err(createStoreError(`Failed to get multiple keys: ${error}`, StoreErrorCode.OPERATION_FAILED, { keys }));
    }
  }

  /**
   * Sets multiple key-value pairs
   */
  async mset(operations: BatchSetOperation<V>[]): Promise<Result<BatchResult<string>, any>> {
    try {
      const successful: string[] = [];
      const failed: Array<{ key: string; error: any }> = [];
      
      for (const op of operations) {
        const setResult = await this.set(op.key, op.value, op.options);
        if (setResult.ok) {
          successful.push(op.key);
        } else {
          failed.push({ key: op.key, error: setResult.error });
        }
      }
      
      return Ok({ successful, failed });
    } catch (error) {
      return Err(createStoreError(`Failed to set multiple keys: ${error}`, StoreErrorCode.OPERATION_FAILED));
    }
  }

  /**
   * Deletes multiple keys
   */
  async mdel(keys: string[]): Promise<Result<BatchResult<string>, any>> {
    try {
      const successful: string[] = [];
      const failed: Array<{ key: string; error: any }> = [];
      
      for (const key of keys) {
        const delResult = await this.delete(key);
        if (delResult.ok && delResult.value) {
          successful.push(key);
        } else if (!delResult.ok) {
          failed.push({ key, error: delResult.error });
        }
      }
      
      return Ok({ successful, failed });
    } catch (error) {
      return Err(createStoreError(`Failed to delete multiple keys: ${error}`, StoreErrorCode.OPERATION_FAILED, { keys }));
    }
  }

  /**
   * Gets a value with its metadata
   */
  async getWithMetadata(key: string): Promise<Result<StoredValue<V> | undefined, any>> {
    try {
      const entry = this.map.get(key);
      
      if (!entry) {
        this.stats.misses++;
        return Ok(undefined);
      }

      if (this.isExpired(entry)) {
        this.map.delete(key);
        this.removeFromLRU(key);
        this.stats.expirations++;
        this.stats.misses++;
        return Ok(undefined);
      }

      this.stats.hits++;
      return Ok({ value: entry.value, metadata: { ...entry.metadata } });
    } catch (error) {
      return Err(createStoreError(`Failed to get metadata for key "${key}": ${error}`, StoreErrorCode.OPERATION_FAILED, { key }));
    }
  }

  /**
   * Updates the TTL of an existing key
   */
  async updateTtl(key: string, ttlMs: number): Promise<Result<boolean, any>> {
    try {
      const entry = this.map.get(key);
      
      if (!entry) {
        return Ok(false);
      }

      if (this.isExpired(entry)) {
        this.map.delete(key);
        this.removeFromLRU(key);
        this.stats.expirations++;
        return Ok(false);
      }

      entry.metadata.expiresAt = Date.now() + ttlMs;
      return Ok(true);
    } catch (error) {
      return Err(createStoreError(`Failed to update TTL for key "${key}": ${error}`, StoreErrorCode.OPERATION_FAILED, { key }));
    }
  }

  /**
   * Gets the remaining TTL for a key
   */
  async getTtl(key: string): Promise<Result<number | undefined, any>> {
    try {
      const entry = this.map.get(key);
      
      if (!entry) {
        return Ok(undefined);
      }

      if (this.isExpired(entry)) {
        this.map.delete(key);
        this.removeFromLRU(key);
        this.stats.expirations++;
        return Ok(undefined);
      }

      if (!entry.metadata.expiresAt) {
        return Ok(undefined); // No expiration set
      }

      const remaining = entry.metadata.expiresAt - Date.now();
      return Ok(Math.max(0, remaining));
    } catch (error) {
      return Err(createStoreError(`Failed to get TTL for key "${key}": ${error}`, StoreErrorCode.OPERATION_FAILED, { key }));
    }
  }

  /**
   * Lists all keys (use with caution on large stores)
   */
  async keys(pattern?: string): Promise<Result<string[], any>> {
    try {
      const allKeys = Array.from(this.map.keys());
      
      if (!pattern) {
        return Ok(allKeys);
      }

      // Simple pattern matching (supports * wildcard)
      const regex = new RegExp(pattern.replace(/\*/g, '.*'));
      const filteredKeys = allKeys.filter(key => regex.test(key));
      
      return Ok(filteredKeys);
    } catch (error) {
      return Err(createStoreError(`Failed to list keys: ${error}`, StoreErrorCode.OPERATION_FAILED, { pattern }));
    }
  }

  /**
   * Gets the size of a value in bytes
   */
  async sizeof(key: string): Promise<Result<number | undefined, any>> {
    try {
      const entry = this.map.get(key);
      
      if (!entry) {
        return Ok(undefined);
      }

      if (this.isExpired(entry)) {
        this.map.delete(key);
        this.removeFromLRU(key);
        this.stats.expirations++;
        return Ok(undefined);
      }

      return Ok(entry.metadata.sizeBytes);
    } catch (error) {
      return Err(createStoreError(`Failed to get size for key "${key}": ${error}`, StoreErrorCode.OPERATION_FAILED, { key }));
    }
  }

  /**
   * Gets store statistics
   */
  async getStats(): Promise<Result<StoreStats, any>> {
    try {
      const hitRatio = this.stats.hits + this.stats.misses > 0 
        ? this.stats.hits / (this.stats.hits + this.stats.misses) 
        : 0;

      return Ok({
        ...this.stats,
        hitRatio
      });
    } catch (error) {
      return Err(createStoreError(`Failed to get stats: ${error}`, StoreErrorCode.OPERATION_FAILED));
    }
  }

  /**
   * Clears expired items (manual cleanup)
   */
  async cleanup(): Promise<Result<number, any>> {
    try {
      let expiredCount = 0;
      const now = Date.now();
      
      for (const [key, entry] of this.map.entries()) {
        if (entry.metadata.expiresAt && entry.metadata.expiresAt <= now) {
          this.map.delete(key);
          this.removeFromLRU(key);
          this.stats.keyCount--;
          this.stats.memoryUsageBytes -= entry.metadata.sizeBytes;
          this.stats.expirations++;
          expiredCount++;
        }
      }
      
      return Ok(expiredCount);
    } catch (error) {
      return Err(createStoreError(`Failed to cleanup: ${error}`, StoreErrorCode.OPERATION_FAILED));
    }
  }

  /**
   * Checks the health of the store
   */
  async ping(): Promise<Result<boolean, any>> {
    try {
      // Simple health check - try to perform a basic operation
      const testKey = '__ping_test__';
      await this.set(testKey, 'test' as V);
      await this.delete(testKey);
      return Ok(true);
    } catch (error) {
      return Err(createStoreError(`Health check failed: ${error}`, StoreErrorCode.OPERATION_FAILED));
    }
  }

  /**
   * Evicts items based on the configured policy
   */
  async evict(count: number = 1): Promise<Result<string[], any>> {
    try {
      const evictedKeys: string[] = [];
      
      // For LRU eviction, start from tail
      let current = this.lruTail.prev;
      let evicted = 0;
      
      while (current && current !== this.lruHead && evicted < count) {
        const key = current.key;
        const entry = this.map.get(key);
        
        if (entry) {
          this.map.delete(key);
          this.removeFromLRU(key);
          this.stats.keyCount--;
          this.stats.memoryUsageBytes -= entry.metadata.sizeBytes;
          this.stats.evictions++;
          evictedKeys.push(key);
          evicted++;
        }
        
        current = current.prev;
      }
      
      return Ok(evictedKeys);
    } catch (error) {
      return Err(createStoreError(`Failed to evict: ${error}`, StoreErrorCode.OPERATION_FAILED, { count }));
    }
  }

  /**
   * Gets the least recently used keys
   */
  async getLruKeys(count: number): Promise<Result<string[], any>> {
    try {
      const keys: string[] = [];
      let current = this.lruTail.prev;
      let collected = 0;
      
      while (current && current !== this.lruHead && collected < count) {
        keys.push(current.key);
        current = current.prev;
        collected++;
      }
      
      return Ok(keys);
    } catch (error) {
      return Err(createStoreError(`Failed to get LRU keys: ${error}`, StoreErrorCode.OPERATION_FAILED, { count }));
    }
  }

  /**
   * Gets the least frequently used keys
   */
  async getLfuKeys(count: number): Promise<Result<string[], any>> {
    try {
      const entries = Array.from(this.map.entries());
      entries.sort((a, b) => a[1].metadata.accessCount - b[1].metadata.accessCount);
      
      const keys = entries.slice(0, count).map(([key]) => key);
      return Ok(keys);
    } catch (error) {
      return Err(createStoreError(`Failed to get LFU keys: ${error}`, StoreErrorCode.OPERATION_FAILED, { count }));
    }
  }

  /**
   * Destroys the store and cleans up resources
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
    this.map.clear();
    this.keyToNode.clear();
  }

  // Private helper methods

  private isExpired(entry: InMemoryEntry<V>): boolean {
    return entry.metadata.expiresAt !== undefined && entry.metadata.expiresAt <= Date.now();
  }

  private calculateSize(value: V): number {
    // Rough estimation of memory usage
    return JSON.stringify(value).length * 2; // Approximate UTF-16 encoding
  }

  private moveToHead(key: string): void {
    let node = this.keyToNode.get(key);
    
    if (!node) {
      // Create new node
      node = { key };
      this.keyToNode.set(key, node);
    } else {
      // Remove from current position
      this.removeNode(node);
    }
    
    // Add to head
    this.addToHead(node);
  }

  private removeFromLRU(key: string): void {
    const node = this.keyToNode.get(key);
    if (node) {
      this.removeNode(node);
      this.keyToNode.delete(key);
    }
  }

  private removeNode(node: LRUNode): void {
    if (node.prev) node.prev.next = node.next;
    if (node.next) node.next.prev = node.prev;
  }

  private addToHead(node: LRUNode): void {
    node.prev = this.lruHead;
    node.next = this.lruHead.next;
    
    if (this.lruHead.next) {
      this.lruHead.next.prev = node;
    }
    this.lruHead.next = node;
  }

  private async evictToMakeSpace(requiredBytes: number): Promise<void> {
    const maxBytes = this.config.maxMemoryBytes || Infinity;
    const targetBytes: number = maxBytes - requiredBytes;
    
    // Evict until we have enough space
    while (this.stats.memoryUsageBytes > targetBytes) {
      const evictResult = await this.evict(10); // Evict in batches
      if (evictResult.ok && evictResult.value.length === 0) {
        break; // No more items to evict
      }
    }
  }

  private startCleanupTimer(): void {
    if (this.config.cleanupIntervalMs) {
      this.cleanupTimer = setInterval(() => {
        this.cleanup();
      }, this.config.cleanupIntervalMs);
    }
  }
}
