import type { 
  IKeyValueStore, 
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
import { getGlobalConfig } from "../../core/config";

/**
 * Configuration for multi-tier cache
 */
export interface MultiTierConfig {
  /** TTL for L1 cache (memory) in milliseconds */
  l1TtlMs?: number;
  /** TTL for L2 cache (Redis/external) in milliseconds */  
  l2TtlMs?: number;
  /** Whether to populate L1 on L2 hits */
  populateL1OnL2Hit?: boolean;
  /** Whether to write-through to L2 on L1 writes */
  writeThrough?: boolean;
  /** Whether to write-behind to L2 (async) */
  writeBehind?: boolean;
  /** Write-behind delay in milliseconds */
  writeBehindDelayMs?: number;
}

/**
 * Multi-tier cache store combining fast L1 (memory) with persistent L2 (Redis/external)
 * 
 * Architecture:
 * - L1: Fast in-memory cache (EnhancedMemoryStore)
 * - L2: Persistent external cache (Redis, Memcached, etc.)
 * 
 * Strategies:
 * - Read-through: L1 miss → check L2 → populate L1
 * - Write-through: Write to both L1 and L2 synchronously  
 * - Write-behind: Write to L1 immediately, L2 asynchronously
 * - Cache-aside: Manual cache management
 * 
 * Benefits:
 * - Sub-millisecond reads from L1
 * - Persistence and sharing via L2
 * - Automatic failover between tiers
 * - Configurable consistency models
 */
export class MultiTierStore<V = unknown> implements IKeyValueStore<V> {
  private readonly l1Cache: IKeyValueStore<V>;
  private readonly l2Cache: IKeyValueStore<V>;
  private readonly config: Required<MultiTierConfig>;
  private readonly logger = getGlobalConfig().get('logger');
  
  // Write-behind queue
  private readonly writeBehindQueue = new Map<string, { value: V; options?: SetOptions; timestamp: number }>();
  private writeBehindTimer?: NodeJS.Timeout;

  constructor(
    l1Cache: IKeyValueStore<V>,
    l2Cache: IKeyValueStore<V>,
    config: MultiTierConfig = {}
  ) {
    this.l1Cache = l1Cache;
    this.l2Cache = l2Cache;
    
    this.config = {
      l1TtlMs: config.l1TtlMs ?? 60 * 1000, // 1 minute
      l2TtlMs: config.l2TtlMs ?? 60 * 60 * 1000, // 1 hour  
      populateL1OnL2Hit: config.populateL1OnL2Hit ?? true,
      writeThrough: config.writeThrough ?? true,
      writeBehind: config.writeBehind ?? false,
      writeBehindDelayMs: config.writeBehindDelayMs ?? 5000
    };

    if (this.config.writeBehind) {
      this.startWriteBehindProcessor();
    }
  }

  /**
   * Retrieves a value by key (read-through cache)
   */
  async get(key: string, options?: GetOptions): Promise<Result<V | undefined, any>> {
    try {
      // Try L1 first
      const l1Result = await this.l1Cache.get(key, options);
      
      if (l1Result.ok && l1Result.value !== undefined) {
        this.logger?.debug('L1 cache hit', { key });
        return l1Result;
      }

      // L1 miss, try L2
      this.logger?.debug('L1 cache miss, checking L2', { key });
      const l2Result = await this.l2Cache.get(key, options);
      
      if (!l2Result.ok) {
        return l2Result;
      }

      if (l2Result.value !== undefined) {
        this.logger?.debug('L2 cache hit', { key });
        
        // Populate L1 if configured
        if (this.config.populateL1OnL2Hit) {
          const l1SetResult = await this.l1Cache.set(key, l2Result.value, {
            ttlMs: this.config.l1TtlMs,
            overwrite: true
          });
          
          if (!l1SetResult.ok) {
            this.logger?.warn('Failed to populate L1 from L2 hit', { key, error: l1SetResult.error });
          }
        }
        
        return l2Result;
      }

      // Both L1 and L2 miss
      this.logger?.debug('Cache miss on both L1 and L2', { key });
      return Ok(options?.defaultValue as V | undefined);

    } catch (error) {
      return Err(createStoreError(`Multi-tier get failed: ${error}`, StoreErrorCode.OPERATION_FAILED, { key }));
    }
  }

  /**
   * Stores a value with the given key
   */
  async set(key: string, value: V, options?: SetOptions): Promise<Result<void, any>> {
    try {
      // Always write to L1 immediately
      const l1SetResult = await this.l1Cache.set(key, value, {
        ...options,
        ttlMs: options?.ttlMs ?? this.config.l1TtlMs
      });

      if (!l1SetResult.ok) {
        return l1SetResult;
      }

      // Handle L2 writing based on strategy
      if (this.config.writeThrough) {
        // Synchronous write to L2
        const l2SetResult = await this.l2Cache.set(key, value, {
          ...options,
          ttlMs: options?.ttlMs ?? this.config.l2TtlMs
        });
        
        if (!l2SetResult.ok) {
          this.logger?.warn('L2 write-through failed', { key, error: l2SetResult.error });
          // Decide whether to fail the entire operation or continue
          // For now, we'll log and continue since L1 succeeded
        }
      } else if (this.config.writeBehind) {
        // Asynchronous write to L2
        this.queueWriteBehind(key, value, {
          ...options,
          ttlMs: options?.ttlMs ?? this.config.l2TtlMs
        });
      }

      return Ok(undefined);

    } catch (error) {
      return Err(createStoreError(`Multi-tier set failed: ${error}`, StoreErrorCode.OPERATION_FAILED, { key }));
    }
  }

  /**
   * Checks if a key exists in either tier
   */
  async has(key: string): Promise<Result<boolean, any>> {
    try {
      // Check L1 first
      const l1Result = await this.l1Cache.has(key);
      if (l1Result.ok && l1Result.value) {
        return Ok(true);
      }

      // Check L2
      const l2Result = await this.l2Cache.has(key);
      return l2Result;

    } catch (error) {
      return Err(createStoreError(`Multi-tier has failed: ${error}`, StoreErrorCode.OPERATION_FAILED, { key }));
    }
  }

  /**
   * Deletes a value by key from both tiers
   */
  async delete(key: string): Promise<Result<boolean, any>> {
    try {
      let deleted = false;

      // Delete from L1
      const l1Result = await this.l1Cache.delete(key);
      if (l1Result.ok && l1Result.value) {
        deleted = true;
      }

      // Delete from L2
      const l2Result = await this.l2Cache.delete(key);
      if (l2Result.ok && l2Result.value) {
        deleted = true;
      }

      // Remove from write-behind queue if present
      this.writeBehindQueue.delete(key);

      return Ok(deleted);

    } catch (error) {
      return Err(createStoreError(`Multi-tier delete failed: ${error}`, StoreErrorCode.OPERATION_FAILED, { key }));
    }
  }

  /**
   * Clears all values from both tiers
   */
  async clear(): Promise<Result<void, any>> {
    try {
      // Clear both tiers
      const [l1Result, l2Result] = await Promise.all([
        this.l1Cache.clear(),
        this.l2Cache.clear()
      ]);

      // Clear write-behind queue
      this.writeBehindQueue.clear();

      // Return error if either tier failed
      if (!l1Result.ok) return l1Result;
      if (!l2Result.ok) return l2Result;

      return Ok(undefined);

    } catch (error) {
      return Err(createStoreError(`Multi-tier clear failed: ${error}`, StoreErrorCode.OPERATION_FAILED));
    }
  }

  /**
   * Retrieves multiple values by keys
   */
  async mget(keys: string[], options?: GetOptions): Promise<Result<Map<string, V>, any>> {
    try {
      // Try L1 first for all keys
      const l1Result = await this.l1Cache.mget(keys, options);
      if (!l1Result.ok) {
        return l1Result;
      }

      const result = new Map<string, V>(l1Result.value);
      const l1Misses: string[] = [];

      // Find keys that missed in L1
      for (const key of keys) {
        if (!result.has(key)) {
          l1Misses.push(key);
        }
      }

      // Check L2 for L1 misses
      if (l1Misses.length > 0) {
        const l2Result = await this.l2Cache.mget(l1Misses, options);
        if (l2Result.ok) {
          // Add L2 hits to result
          for (const [key, value] of l2Result.value.entries()) {
            result.set(key, value);
            
            // Optionally populate L1
            if (this.config.populateL1OnL2Hit) {
              this.l1Cache.set(key, value, {
                ttlMs: this.config.l1TtlMs,
                overwrite: true
              }).catch(error => {
                this.logger?.warn('Failed to populate L1 from L2 mget hit', { key, error });
              });
            }
          }
        }
      }

      return Ok(result);

    } catch (error) {
      return Err(createStoreError(`Multi-tier mget failed: ${error}`, StoreErrorCode.OPERATION_FAILED, { keys }));
    }
  }

  /**
   * Sets multiple key-value pairs
   */
  async mset(operations: BatchSetOperation<V>[]): Promise<Result<BatchResult<string>, any>> {
    try {
      // Prepare operations for each tier
      const l1Operations = operations.map(op => ({
        ...op,
        options: {
          ...op.options,
          ttlMs: op.options?.ttlMs ?? this.config.l1TtlMs
        }
      }));

      const l2Operations = operations.map(op => ({
        ...op,
        options: {
          ...op.options,
          ttlMs: op.options?.ttlMs ?? this.config.l2TtlMs
        }
      }));

      // Always write to L1
      const l1Result = await this.l1Cache.mset(l1Operations);
      if (!l1Result.ok) {
        return l1Result;
      }

      // Handle L2 based on strategy
      if (this.config.writeThrough) {
        const l2Result = await this.l2Cache.mset(l2Operations);
        // Log L2 failures but don't fail the operation
        if (!l2Result.ok) {
          this.logger?.warn('L2 write-through mset failed', { error: l2Result.error });
        }
      } else if (this.config.writeBehind) {
        // Queue for write-behind
        for (const op of operations) {
          this.queueWriteBehind(op.key, op.value, op.options);
        }
      }

      return l1Result;

    } catch (error) {
      return Err(createStoreError(`Multi-tier mset failed: ${error}`, StoreErrorCode.OPERATION_FAILED));
    }
  }

  /**
   * Deletes multiple keys
   */
  async mdel(keys: string[]): Promise<Result<BatchResult<string>, any>> {
    try {
      // Delete from both tiers
      const [l1Result, l2Result] = await Promise.all([
        this.l1Cache.mdel(keys),
        this.l2Cache.mdel(keys)
      ]);

      // Remove from write-behind queue
      keys.forEach(key => this.writeBehindQueue.delete(key));

      // Combine results
      const successful = new Set([
        ...(l1Result.ok ? l1Result.value.successful : []),
        ...(l2Result.ok ? l2Result.value.successful : [])
      ]);

      const failed = [
        ...(l1Result.ok ? l1Result.value.failed : []),
        ...(l2Result.ok ? l2Result.value.failed : [])
      ];

      return Ok({
        successful: Array.from(successful),
        failed
      });

    } catch (error) {
      return Err(createStoreError(`Multi-tier mdel failed: ${error}`, StoreErrorCode.OPERATION_FAILED, { keys }));
    }
  }

  // Delegate other methods to L1 cache (with L2 fallback where appropriate)
  
  async getWithMetadata(key: string): Promise<Result<StoredValue<V> | undefined, any>> {
    // Try L1 first, then L2
    const l1Result = await this.l1Cache.getWithMetadata(key);
    if (l1Result.ok && l1Result.value) {
      return l1Result;
    }
    return this.l2Cache.getWithMetadata(key);
  }

  async updateTtl(key: string, ttlMs: number): Promise<Result<boolean, any>> {
    // Update TTL in both tiers
    const [l1Result, l2Result] = await Promise.all([
      this.l1Cache.updateTtl(key, ttlMs),
      this.l2Cache.updateTtl(key, ttlMs)
    ]);
    
    return Ok((l1Result.ok && l1Result.value) || (l2Result.ok && l2Result.value));
  }

  async getTtl(key: string): Promise<Result<number | undefined, any>> {
    // Get TTL from L1 first
    const l1Result = await this.l1Cache.getTtl(key);
    if (l1Result.ok && l1Result.value !== undefined) {
      return l1Result;
    }
    return this.l2Cache.getTtl(key);
  }

  async keys(pattern?: string): Promise<Result<string[], any>> {
    // Combine keys from both tiers
    const [l1Result, l2Result] = await Promise.all([
      this.l1Cache.keys(pattern),
      this.l2Cache.keys(pattern)
    ]);
    
    const allKeys = new Set([
      ...(l1Result.ok ? l1Result.value : []),
      ...(l2Result.ok ? l2Result.value : [])
    ]);
    
    return Ok(Array.from(allKeys));
  }

  async sizeof(key: string): Promise<Result<number | undefined, any>> {
    // Try L1 first, then L2
    const l1Result = await this.l1Cache.sizeof(key);
    if (l1Result.ok && l1Result.value !== undefined) {
      return l1Result;
    }
    return this.l2Cache.sizeof(key);
  }

  async getStats(): Promise<Result<StoreStats, any>> {
    // Combine stats from both tiers
    const [l1Result, l2Result] = await Promise.all([
      this.l1Cache.getStats(),
      this.l2Cache.getStats()
    ]);
    
    const l1Stats = l1Result.ok ? l1Result.value : this.getEmptyStats();
    const l2Stats = l2Result.ok ? l2Result.value : this.getEmptyStats();
    
    return Ok({
      keyCount: Math.max(l1Stats.keyCount, l2Stats.keyCount),
      memoryUsageBytes: l1Stats.memoryUsageBytes + l2Stats.memoryUsageBytes,
      hits: l1Stats.hits + l2Stats.hits,
      misses: l1Stats.misses + l2Stats.misses,
      hitRatio: (l1Stats.hits + l2Stats.hits) / (l1Stats.hits + l2Stats.hits + l1Stats.misses + l2Stats.misses) || 0,
      evictions: l1Stats.evictions + l2Stats.evictions,
      expirations: l1Stats.expirations + l2Stats.expirations
    });
  }

  async cleanup(): Promise<Result<number, any>> {
    const [l1Result, l2Result] = await Promise.all([
      this.l1Cache.cleanup(),
      this.l2Cache.cleanup()
    ]);
    
    const cleaned = (l1Result.ok ? l1Result.value : 0) + (l2Result.ok ? l2Result.value : 0);
    return Ok(cleaned);
  }

  async ping(): Promise<Result<boolean, any>> {
    // Both tiers should be healthy
    const [l1Result, l2Result] = await Promise.all([
      this.l1Cache.ping(),
      this.l2Cache.ping()
    ]);
    
    return Ok((l1Result.ok && l1Result.value) && (l2Result.ok && l2Result.value));
  }

  /**
   * Destroys the store and cleans up resources
   */
  async destroy(): Promise<void> {
    if (this.writeBehindTimer) {
      clearInterval(this.writeBehindTimer);
      this.writeBehindTimer = undefined;
    }
    
    // Process remaining write-behind operations
    await this.processWriteBehindQueue();
    
    // Destroy both caches if they support it
    if ('destroy' in this.l1Cache && typeof this.l1Cache.destroy === 'function') {
      await this.l1Cache.destroy();
    }
    if ('destroy' in this.l2Cache && typeof this.l2Cache.destroy === 'function') {
      await this.l2Cache.destroy();
    }
  }

  // Private helper methods

  private queueWriteBehind(key: string, value: V, options?: SetOptions): void {
    this.writeBehindQueue.set(key, {
      value,
      options,
      timestamp: Date.now()
    });
  }

  private startWriteBehindProcessor(): void {
    this.writeBehindTimer = setInterval(() => {
      this.processWriteBehindQueue().catch(error => {
        this.logger?.error('Write-behind processing failed', { error });
      });
    }, this.config.writeBehindDelayMs);
  }

  private async processWriteBehindQueue(): Promise<void> {
    if (this.writeBehindQueue.size === 0) return;

    const operations: BatchSetOperation<V>[] = [];
    const keysToRemove: string[] = [];

    for (const [key, item] of this.writeBehindQueue.entries()) {
      operations.push({
        key,
        value: item.value,
        options: item.options
      });
      keysToRemove.push(key);
    }

    try {
      await this.l2Cache.mset(operations);
      keysToRemove.forEach(key => this.writeBehindQueue.delete(key));
      this.logger?.debug(`Processed ${operations.length} write-behind operations`);
    } catch (error) {
      this.logger?.error('Write-behind batch failed', { error, count: operations.length });
    }
  }

  private getEmptyStats(): StoreStats {
    return {
      keyCount: 0,
      memoryUsageBytes: 0,
      hits: 0,
      misses: 0,
      hitRatio: 0,
      evictions: 0,
      expirations: 0
    };
  }
}
