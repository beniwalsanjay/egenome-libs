import { injectable } from 'inversify';
import 'reflect-metadata';

import type { IKeyValueStore, SetOptions, GetOptions, ValueMetadata, StoredValue, BatchSetOperation, BatchResult, StoreStats } from "../../core/contracts/key-value-store";
import type { Result } from "../../core/result";
import { Ok, Err } from "../../core/result";
import { createStoreError, StoreErrorCode } from "../../core/errors";

/**
 * Legacy InMemoryStore - Simple implementation for backward compatibility
 * For advanced features, use EnhancedMemoryStore instead
 */
@injectable()
export class InMemoryStore<V = unknown> implements IKeyValueStore<V> {
  private map: Map<string, V> = new Map<string, V>();

  async get(key: string, options?: GetOptions): Promise<Result<V | undefined, any>> {
    try {
      const value = this.map.get(key);
      return Ok(value !== undefined ? value : options?.defaultValue as V | undefined);
    } catch (error) {
      return Err(createStoreError(`Failed to get key "${key}": ${error}`, StoreErrorCode.OPERATION_FAILED, { key }));
    }
  }

  async set(key: string, value: V, options?: SetOptions): Promise<Result<void, any>> {
    try {
      if (this.map.has(key) && options?.overwrite === false) {
        return Err(createStoreError(`Key "${key}" already exists and overwrite is disabled`, StoreErrorCode.OPERATION_FAILED, { key }));
      }
      this.map.set(key, value);
      return Ok(undefined);
    } catch (error) {
      return Err(createStoreError(`Failed to set key "${key}": ${error}`, StoreErrorCode.OPERATION_FAILED, { key }));
    }
  }

  async has(key: string): Promise<Result<boolean, any>> {
    try {
      return Ok(this.map.has(key));
    } catch (error) {
      return Err(createStoreError(`Failed to check key "${key}": ${error}`, StoreErrorCode.OPERATION_FAILED, { key }));
    }
  }

  async delete(key: string): Promise<Result<boolean, any>> {
    try {
      return Ok(this.map.delete(key));
    } catch (error) {
      return Err(createStoreError(`Failed to delete key "${key}": ${error}`, StoreErrorCode.OPERATION_FAILED, { key }));
    }
  }

  async clear(): Promise<Result<void, any>> {
    try {
      this.map.clear();
      return Ok(undefined);
    } catch (error) {
      return Err(createStoreError(`Failed to clear store: ${error}`, StoreErrorCode.OPERATION_FAILED));
    }
  }

  // Minimal implementations for new interface methods
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

  async getWithMetadata(key: string): Promise<Result<StoredValue<V> | undefined, any>> {
    try {
      const value = this.map.get(key);
      if (value === undefined) {
        return Ok(undefined);
      }
      
      const metadata: ValueMetadata = {
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
        sizeBytes: JSON.stringify(value).length * 2,
        accessCount: 1
      };
      
      return Ok({ value, metadata });
    } catch (error) {
      return Err(createStoreError(`Failed to get metadata for key "${key}": ${error}`, StoreErrorCode.OPERATION_FAILED, { key }));
    }
  }

  async updateTtl(key: string, ttlMs: number): Promise<Result<boolean, any>> {
    // TTL not supported in basic implementation
    return Ok(this.map.has(key));
  }

  async getTtl(key: string): Promise<Result<number | undefined, any>> {
    // TTL not supported in basic implementation
    return Ok(undefined);
  }

  async keys(pattern?: string): Promise<Result<string[], any>> {
    try {
      const allKeys = Array.from(this.map.keys());
      
      if (!pattern) {
        return Ok(allKeys);
      }

      const regex = new RegExp(pattern.replace(/\*/g, '.*'));
      const filteredKeys = allKeys.filter(key => regex.test(key));
      
      return Ok(filteredKeys);
    } catch (error) {
      return Err(createStoreError(`Failed to list keys: ${error}`, StoreErrorCode.OPERATION_FAILED, { pattern }));
    }
  }

  async sizeof(key: string): Promise<Result<number | undefined, any>> {
    try {
      const value = this.map.get(key);
      if (value === undefined) {
        return Ok(undefined);
      }
      return Ok(JSON.stringify(value).length * 2);
    } catch (error) {
      return Err(createStoreError(`Failed to get size for key "${key}": ${error}`, StoreErrorCode.OPERATION_FAILED, { key }));
    }
  }

  async getStats(): Promise<Result<StoreStats, any>> {
    try {
      const stats: StoreStats = {
        keyCount: this.map.size,
        memoryUsageBytes: 0,
        hits: 0,
        misses: 0,
        hitRatio: 0,
        evictions: 0,
        expirations: 0
      };
      return Ok(stats);
    } catch (error) {
      return Err(createStoreError(`Failed to get stats: ${error}`, StoreErrorCode.OPERATION_FAILED));
    }
  }

  async cleanup(): Promise<Result<number, any>> {
    return Ok(0); // No cleanup needed in basic implementation
  }

  async ping(): Promise<Result<boolean, any>> {
    try {
      return Ok(true);
    } catch (error) {
      return Err(createStoreError(`Health check failed: ${error}`, StoreErrorCode.OPERATION_FAILED));
    }
  }
}