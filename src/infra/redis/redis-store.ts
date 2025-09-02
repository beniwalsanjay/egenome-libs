// ioredis is an optional dependency
import Redis, { RedisOptions } from 'ioredis';
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
import type { RedisStoreConfig, Logger } from "../../core/config";
import { getGlobalConfig } from "../../core/config";

/**
 * Redis implementation of IKeyValueStore
 * 
 * Features:
 * - Production-ready Redis integration
 * - Connection pooling and retry logic
 * - TTL support with Redis EXPIRE
 * - Batch operations with Redis pipeline
 * - JSON serialization for complex objects
 * - Comprehensive error handling
 * - Statistics tracking
 */
export class RedisStore<V = unknown> implements IKeyValueStore<V> {
  private client: Redis | null = null;
  private readonly config: RedisStoreConfig;
  private readonly logger: Logger;
  
  // Statistics
  private stats = {
    keyCount: 0,
    hits: 0,
    misses: 0,
    operations: 0,
    errors: 0
  };

  constructor(config?: Partial<RedisStoreConfig>) {
    const globalConfig = getGlobalConfig();
    this.config = {
      ...globalConfig.get('stores')?.redis,
      ...config
    };
    this.logger = globalConfig.get('logger') || globalConfig.get('debug') ? 
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      new (require('../../core/config').ConsoleLogger)(true) : 
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      new (require('../../core/config').NoOpLogger)();

    this.initializeClient();
  }

  private initializeClient(): void {
    try {
      const options: RedisOptions = {
        lazyConnect: true,
        maxRetriesPerRequest: 3,
        retryStrategy: (times: number) => {
          const delay = Math.min(times * 50, 2000);
          this.logger.warn(`Redis retry attempt ${times}, delay ${delay}ms`);
          return delay;
        },
        connectTimeout: this.config.connectTimeoutMs,
        commandTimeout: this.config.commandTimeoutMs,
      };

      // Use URL or individual connection params
      if (this.config.url) {
        this.client = new Redis(this.config.url, options);
      } else {
        this.client = new Redis({
          ...options,
          host: this.config.host,
          port: this.config.port,
          password: this.config.password,
          db: this.config.db
        });
      }

      this.setupEventListeners();
    } catch (error) {
      this.logger.error('Failed to initialize Redis client', { error });
    }
  }

  private setupEventListeners(): void {
    if (!this.client) return;

    this.client.on('connect', () => {
      this.logger.info('Redis connected successfully');
    });

    this.client.on('error', (error: Error) => {
      this.logger.error('Redis connection error', { error: error.message });
      this.stats.errors++;
    });

    this.client.on('reconnecting', () => {
      this.logger.info('Redis reconnecting...');
    });

    this.client.on('ready', () => {
      this.logger.info('Redis client ready');
    });
  }

  private async ensureConnection(): Promise<void> {
    if (!this.client) {
      throw new Error('Redis client not initialized');
    }

    if (this.client.status !== 'ready') {
      await this.client.connect();
    }
  }

  private serialize(value: V): string {
    const config = getGlobalConfig();
    const serializer = config.get('serialization')?.serializer || JSON.stringify;
    return serializer(value);
  }

  private deserialize(value: string): V {
    const config = getGlobalConfig();
    const deserializer = config.get('serialization')?.deserializer || JSON.parse;
    return deserializer(value);
  }

  private createMetadataKey(key: string): string {
    return `__meta__:${key}`;
  }

  /**
   * Retrieves a value by key
   */
  async get(key: string, options?: GetOptions): Promise<Result<V | undefined, any>> {
    try {
      await this.ensureConnection();
      this.stats.operations++;

      const pipeline = this.client!.pipeline();
      pipeline.get(key);
      pipeline.get(this.createMetadataKey(key));
      
      if (options?.refreshTtl) {
        pipeline.ttl(key);
      }

      const results = await pipeline.exec();
      
      if (!results || results.some((result: any) => result && result[0])) {
        this.stats.errors++;
        return Err(createStoreError('Redis pipeline failed', StoreErrorCode.OPERATION_FAILED, { key }));
      }

      const [valueResult, metaResult, ttlResult] = results;
      const rawValue = valueResult?.[1] as string | null;
      const rawMeta = metaResult?.[1] as string | null;

      if (rawValue === null) {
        this.stats.misses++;
        return Ok(options?.defaultValue as V | undefined);
      }

      // Parse metadata if available
      let metadata: ValueMetadata | null = null;
      if (rawMeta) {
        try {
          metadata = JSON.parse(rawMeta);
        } catch {
          // Ignore metadata parsing errors
        }
      }

      // Check expiration
      if (metadata?.expiresAt && metadata.expiresAt <= Date.now()) {
        // Clean up expired key
        await this.client!.del(key, this.createMetadataKey(key));
        this.stats.misses++;
        return Ok(options?.defaultValue as V | undefined);
      }

      // Refresh TTL if requested
      if (options?.refreshTtl && ttlResult && ttlResult[1] !== -1) {
        const ttl = ttlResult[1] as number;
        await this.client!.expire(key, ttl);
      }

      // Update access metadata
      if (metadata) {
        metadata.lastAccessedAt = Date.now();
        metadata.accessCount++;
        await this.client!.set(this.createMetadataKey(key), JSON.stringify(metadata));
      }

      const value = this.deserialize(rawValue);
      this.stats.hits++;
      return Ok(value);

    } catch (error) {
      this.stats.errors++;
      return Err(createStoreError(`Redis get failed: ${error}`, StoreErrorCode.OPERATION_FAILED, { key }));
    }
  }

  /**
   * Stores a value with the given key
   */
  async set(key: string, value: V, options?: SetOptions): Promise<Result<void, any>> {
    try {
      await this.ensureConnection();
      this.stats.operations++;

      if (options?.overwrite === false) {
        const exists = await this.client!.exists(key);
        if (exists) {
          return Err(createStoreError(`Key "${key}" already exists`, StoreErrorCode.OPERATION_FAILED, { key }));
        }
      }

      const serializedValue = this.serialize(value);
      const now = Date.now();
      
      // Create metadata
      const metadata: ValueMetadata = {
        createdAt: now,
        lastAccessedAt: now,
        expiresAt: options?.ttlMs ? now + options.ttlMs : undefined,
        sizeBytes: serializedValue.length,
        accessCount: 1
      };

      const pipeline = this.client!.pipeline();
      
      if (options?.ttlMs) {
        pipeline.setex(key, Math.ceil(options.ttlMs / 1000), serializedValue);
      } else {
        pipeline.set(key, serializedValue);
      }
      
      pipeline.set(this.createMetadataKey(key), JSON.stringify(metadata));
      
      if (options?.ttlMs) {
        pipeline.expire(this.createMetadataKey(key), Math.ceil(options.ttlMs / 1000));
      }

      const results = await pipeline.exec();
      
      if (!results || results.some((result: any) => result && result[0])) {
        this.stats.errors++;
        return Err(createStoreError('Redis pipeline failed', StoreErrorCode.OPERATION_FAILED, { key }));
      }

      return Ok(undefined);

    } catch (error) {
      this.stats.errors++;
      return Err(createStoreError(`Redis set failed: ${error}`, StoreErrorCode.OPERATION_FAILED, { key }));
    }
  }

  /**
   * Checks if a key exists in the store
   */
  async has(key: string): Promise<Result<boolean, any>> {
    try {
      await this.ensureConnection();
      this.stats.operations++;

      const exists = await this.client!.exists(key);
      return Ok(exists === 1);

    } catch (error) {
      this.stats.errors++;
      return Err(createStoreError(`Redis has failed: ${error}`, StoreErrorCode.OPERATION_FAILED, { key }));
    }
  }

  /**
   * Deletes a value by key
   */
  async delete(key: string): Promise<Result<boolean, any>> {
    try {
      await this.ensureConnection();
      this.stats.operations++;

      const pipeline = this.client!.pipeline();
      pipeline.del(key);
      pipeline.del(this.createMetadataKey(key));
      
      const results = await pipeline.exec();
      
      if (!results) {
        return Err(createStoreError('Redis pipeline failed', StoreErrorCode.OPERATION_FAILED, { key }));
      }

      const deleted = (results[0]?.[1] as number) || 0;
      return Ok(deleted > 0);

    } catch (error) {
      this.stats.errors++;
      return Err(createStoreError(`Redis delete failed: ${error}`, StoreErrorCode.OPERATION_FAILED, { key }));
    }
  }

  /**
   * Clears all values from the store
   */
  async clear(): Promise<Result<void, any>> {
    try {
      await this.ensureConnection();
      this.stats.operations++;

      await this.client!.flushdb();
      this.stats = { ...this.stats, keyCount: 0 };
      return Ok(undefined);

    } catch (error) {
      this.stats.errors++;
      return Err(createStoreError(`Redis clear failed: ${error}`, StoreErrorCode.OPERATION_FAILED));
    }
  }

  /**
   * Retrieves multiple values by keys
   */
  async mget(keys: string[], options?: GetOptions): Promise<Result<Map<string, V>, any>> {
    try {
      await this.ensureConnection();
      this.stats.operations++;

      const pipeline = this.client!.pipeline();
      keys.forEach(key => pipeline.get(key));
      
      const results = await pipeline.exec();
      
      if (!results) {
        return Err(createStoreError('Redis mget pipeline failed', StoreErrorCode.OPERATION_FAILED, { keys }));
      }

      const resultMap = new Map<string, V>();
      
      for (let i = 0; i < keys.length; i++) {
        const result = results[i];
        if (result && !result[0] && result[1] !== null) {
          const value = this.deserialize(result[1] as string);
          resultMap.set(keys[i], value);
          this.stats.hits++;
        } else {
          this.stats.misses++;
        }
      }

      return Ok(resultMap);

    } catch (error) {
      this.stats.errors++;
      return Err(createStoreError(`Redis mget failed: ${error}`, StoreErrorCode.OPERATION_FAILED, { keys }));
    }
  }

  /**
   * Sets multiple key-value pairs
   */
  async mset(operations: BatchSetOperation<V>[]): Promise<Result<BatchResult<string>, any>> {
    try {
      await this.ensureConnection();
      this.stats.operations++;

      const pipeline = this.client!.pipeline();
      const successful: string[] = [];
      const failed: Array<{ key: string; error: any }> = [];

      for (const op of operations) {
        try {
          const serializedValue = this.serialize(op.value);
          
          if (op.options?.ttlMs) {
            pipeline.setex(op.key, Math.ceil(op.options.ttlMs / 1000), serializedValue);
          } else {
            pipeline.set(op.key, serializedValue);
          }
          
          successful.push(op.key);
        } catch (error) {
          failed.push({ key: op.key, error: createStoreError(`Serialization failed: ${error}`, StoreErrorCode.SERIALIZATION_FAILED) });
        }
      }

      await pipeline.exec();
      return Ok({ successful, failed });

    } catch (error) {
      this.stats.errors++;
      return Err(createStoreError(`Redis mset failed: ${error}`, StoreErrorCode.OPERATION_FAILED));
    }
  }

  /**
   * Deletes multiple keys
   */
  async mdel(keys: string[]): Promise<Result<BatchResult<string>, any>> {
    try {
      await this.ensureConnection();
      this.stats.operations++;

      const deletedCount = await this.client!.del(...keys);
      
      // Redis doesn't tell us which specific keys were deleted
      // We assume all were successful if no error occurred
      const successful = keys.slice(0, deletedCount);
      const failed: Array<{ key: string; error: any }> = [];

      return Ok({ successful, failed });

    } catch (error) {
      this.stats.errors++;
      return Err(createStoreError(`Redis mdel failed: ${error}`, StoreErrorCode.OPERATION_FAILED, { keys }));
    }
  }

  /**
   * Gets a value with its metadata
   */
  async getWithMetadata(key: string): Promise<Result<StoredValue<V> | undefined, any>> {
    try {
      await this.ensureConnection();
      
      const pipeline = this.client!.pipeline();
      pipeline.get(key);
      pipeline.get(this.createMetadataKey(key));
      
      const results = await pipeline.exec();
      
      if (!results) {
        return Err(createStoreError('Redis pipeline failed', StoreErrorCode.OPERATION_FAILED, { key }));
      }

      const [valueResult, metaResult] = results;
      const rawValue = valueResult?.[1] as string | null;
      const rawMeta = metaResult?.[1] as string | null;

      if (rawValue === null) {
        return Ok(undefined);
      }

      let metadata: ValueMetadata;
      if (rawMeta) {
        try {
          metadata = JSON.parse(rawMeta);
        } catch {
          // Fallback metadata
          metadata = {
            createdAt: Date.now(),
            lastAccessedAt: Date.now(),
            sizeBytes: rawValue.length,
            accessCount: 1
          };
        }
      } else {
        metadata = {
          createdAt: Date.now(),
          lastAccessedAt: Date.now(),
          sizeBytes: rawValue.length,
          accessCount: 1
        };
      }

      const value = this.deserialize(rawValue);
      return Ok({ value, metadata });

    } catch (error) {
      return Err(createStoreError(`Redis getWithMetadata failed: ${error}`, StoreErrorCode.OPERATION_FAILED, { key }));
    }
  }

  /**
   * Updates the TTL of an existing key
   */
  async updateTtl(key: string, ttlMs: number): Promise<Result<boolean, any>> {
    try {
      await this.ensureConnection();
      
      const exists = await this.client!.exists(key);
      if (!exists) {
        return Ok(false);
      }

      const result = await this.client!.expire(key, Math.ceil(ttlMs / 1000));
      return Ok(result === 1);

    } catch (error) {
      return Err(createStoreError(`Redis updateTtl failed: ${error}`, StoreErrorCode.OPERATION_FAILED, { key }));
    }
  }

  /**
   * Gets the remaining TTL for a key
   */
  async getTtl(key: string): Promise<Result<number | undefined, any>> {
    try {
      await this.ensureConnection();
      
      const ttl = await this.client!.ttl(key);
      
      if (ttl === -2) {
        return Ok(undefined); // Key doesn't exist
      }
      
      if (ttl === -1) {
        return Ok(undefined); // Key exists but has no TTL
      }

      return Ok(ttl * 1000); // Convert to milliseconds

    } catch (error) {
      return Err(createStoreError(`Redis getTtl failed: ${error}`, StoreErrorCode.OPERATION_FAILED, { key }));
    }
  }

  /**
   * Lists all keys (use with caution on large stores)
   */
  async keys(pattern: string = '*'): Promise<Result<string[], any>> {
    try {
      await this.ensureConnection();
      
      // Filter out metadata keys
      const allKeys = await this.client!.keys(pattern);
      const filteredKeys = allKeys.filter((key: string) => !key.startsWith('__meta__:'));
      
      return Ok(filteredKeys);

    } catch (error) {
      return Err(createStoreError(`Redis keys failed: ${error}`, StoreErrorCode.OPERATION_FAILED, { pattern }));
    }
  }

  /**
   * Gets the size of a value in bytes
   */
  async sizeof(key: string): Promise<Result<number | undefined, any>> {
    try {
      await this.ensureConnection();
      
      const size = await this.client!.strlen(key);
      return Ok(size > 0 ? size : undefined);

    } catch (error) {
      return Err(createStoreError(`Redis sizeof failed: ${error}`, StoreErrorCode.OPERATION_FAILED, { key }));
    }
  }

  /**
   * Gets store statistics
   */
  async getStats(): Promise<Result<StoreStats, any>> {
    try {
      await this.ensureConnection();
      
      const info = await this.client!.info('keyspace');
      const keyCount = this.parseKeyCount(info);
      
      const hitRatio = this.stats.hits + this.stats.misses > 0 
        ? this.stats.hits / (this.stats.hits + this.stats.misses) 
        : 0;

      return Ok({
        keyCount,
        memoryUsageBytes: 0, // Would need Redis MEMORY USAGE command
        hits: this.stats.hits,
        misses: this.stats.misses,
        hitRatio,
        evictions: 0, // Redis handles eviction internally
        expirations: 0 // Redis handles expiration internally
      });

    } catch (error) {
      return Err(createStoreError(`Redis getStats failed: ${error}`, StoreErrorCode.OPERATION_FAILED));
    }
  }

  private parseKeyCount(info: string): number {
    const match = info.match(/keys=(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  }

  /**
   * Clears expired items (Redis handles this automatically)
   */
  async cleanup(): Promise<Result<number, any>> {
    // Redis handles TTL cleanup automatically
    return Ok(0);
  }

  /**
   * Checks the health of the store
   */
  async ping(): Promise<Result<boolean, any>> {
    try {
      await this.ensureConnection();
      const result = await this.client!.ping();
      return Ok(result === 'PONG');

    } catch (error) {
      return Err(createStoreError(`Redis ping failed: ${error}`, StoreErrorCode.CONNECTION_FAILED));
    }
  }

  /**
   * Destroys the store and cleans up resources
   */
  async destroy(): Promise<void> {
    if (this.client) {
      await this.client.disconnect();
      this.client = null;
    }
  }
}
