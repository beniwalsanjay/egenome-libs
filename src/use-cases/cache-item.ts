import type { IKeyValueStore, SetOptions, GetOptions } from "../core/contracts/key-value-store";
import { Ok, Err, type Result, safeAsync } from "../core/result";
import { createCacheError, CacheErrorCode, isStoreError } from "../core/errors";
import { getGlobalConfig } from "../core/config";

/**
 * Input configuration for cache operations
 */
export interface CacheItemInput<V> {
  /** The store to use for caching */
  store: IKeyValueStore<V>;
  /** The cache key */
  key: string;
  /** Function to fetch the value if not cached */
  fetcher: () => Promise<V>;
  /** Options for cache behavior */
  options?: CacheItemOptions;
}

/**
 * Options for cache item behavior
 */
export interface CacheItemOptions {
  /** Time-to-live for cached values in milliseconds */
  ttlMs?: number;
  /** Whether to refresh TTL on cache hit */
  refreshTtl?: boolean;
  /** Default value to return if both cache and fetcher fail */
  defaultValue?: unknown;
  /** Whether to store the value even if fetcher fails */
  storeOnError?: boolean;
  /** Maximum number of retry attempts for fetcher */
  maxRetries?: number;
  /** Delay between retries in milliseconds */
  retryDelayMs?: number;
}

/**
 * Result of a cache operation with metadata
 */
export interface CacheResult<V> {
  /** The cached or fetched value */
  value: V;
  /** Whether the value came from cache (true) or was freshly fetched (false) */
  fromCache: boolean;
  /** Metadata about the operation */
  metadata: {
    /** Time taken for the operation in milliseconds */
    operationTimeMs: number;
    /** Whether the value was retrieved from cache */
    cacheHit: boolean;
    /** Whether a retry was needed */
    retryAttempted: boolean;
    /** Number of retry attempts made */
    retryCount: number;
  };
}

/**
 * Enhanced cache item use-case with comprehensive error handling and configuration
 * 
 * Features:
 * - TTL support with optional refresh
 * - Retry logic for failed fetchers
 * - Detailed operation metadata
 * - Graceful error handling
 * - Configuration via global config
 */
export async function cacheItem<V>(input: CacheItemInput<V>): Promise<Result<CacheResult<V>, any>> {
  const startTime = Date.now();
  const { store, key, fetcher, options = {} } = input;
  const config = getGlobalConfig();
  
  // Merge options with defaults
  const mergedOptions: Required<CacheItemOptions> = {
    ttlMs: options.ttlMs ?? config.get('defaultTtlMs') ?? 5 * 60 * 1000,
    refreshTtl: options.refreshTtl ?? false,
    defaultValue: options.defaultValue,
    storeOnError: options.storeOnError ?? false,
    maxRetries: options.maxRetries ?? 2,
    retryDelayMs: options.retryDelayMs ?? 1000
  };

  let retryCount = 0;
  let retryAttempted = false;

  try {
    // Try to get from cache first
    const getOptions: GetOptions = {
      refreshTtl: mergedOptions.refreshTtl,
      defaultValue: undefined
    };

    const cacheResult = await store.get(key, getOptions);
    
    if (!cacheResult.ok) {
      config.get('logger')?.warn('Cache get operation failed', { 
        key, 
        error: cacheResult.error,
        context: 'cacheItem'
      });
    } else if (cacheResult.value !== undefined) {
      // Cache hit
      const operationTimeMs = Date.now() - startTime;
      config.get('logger')?.debug('Cache hit', { key, operationTimeMs });
      
      return Ok({
        value: cacheResult.value,
        fromCache: true,
        metadata: {
          operationTimeMs,
          cacheHit: true,
          retryAttempted: false,
          retryCount: 0
        }
      });
    }

    // Cache miss - fetch fresh value
    config.get('logger')?.debug('Cache miss, fetching fresh value', { key });
    
    let fetchResult: Result<V, any> | null = null;
    
    // Retry logic for fetcher
    while (retryCount <= mergedOptions.maxRetries) {
      fetchResult = await safeAsync(fetcher);
      
      if (fetchResult.ok) {
        break;
      }
      
      retryCount++;
      retryAttempted = true;
      
      if (retryCount <= mergedOptions.maxRetries) {
        config.get('logger')?.warn('Fetcher failed, retrying', { 
          key, 
          retryCount, 
          maxRetries: mergedOptions.maxRetries,
          error: fetchResult.error 
        });
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, mergedOptions.retryDelayMs));
      }
    }

    if (!fetchResult || !fetchResult.ok) {
      const lastError = fetchResult?.error || 'Unknown error';
      const error = createCacheError(
        `Failed to fetch value for key "${key}" after ${retryCount} retries: ${lastError}`,
        CacheErrorCode.FETCH_FAILED,
        { key, retryCount, lastError }
      );
      
      config.get('logger')?.error('All fetch attempts failed', { 
        key, 
        retryCount, 
        error: lastError 
      });
      
      // Return default value if available
      if (mergedOptions.defaultValue !== undefined) {
        const operationTimeMs = Date.now() - startTime;
        return Ok({
          value: mergedOptions.defaultValue as V,
          fromCache: false,
          metadata: {
            operationTimeMs,
            cacheHit: false,
            retryAttempted,
            retryCount
          }
        });
      }
      
      return Err(error);
    }

    // Store the fetched value
    const setOptions: SetOptions = {
      ttlMs: mergedOptions.ttlMs,
      overwrite: true
    };

    const storeResult = await store.set(key, fetchResult.value, setOptions);
    
    if (!storeResult.ok) {
      config.get('logger')?.warn('Failed to store cached value', { 
        key, 
        error: storeResult.error 
      });
      
      // Still return the fetched value even if storing failed
      if (!mergedOptions.storeOnError) {
        const operationTimeMs = Date.now() - startTime;
        return Ok({
          value: fetchResult.value,
          fromCache: false,
          metadata: {
            operationTimeMs,
            cacheHit: false,
            retryAttempted,
            retryCount
          }
        });
      }
      
      return Err(createCacheError(
        `Failed to store value for key "${key}": ${storeResult.error}`,
        CacheErrorCode.STORE_FAILED,
        { key, storeError: storeResult.error }
      ));
    }

    const operationTimeMs = Date.now() - startTime;
    config.get('logger')?.debug('Successfully cached fresh value', { 
      key, 
      operationTimeMs,
      retryCount 
    });

    return Ok({
      value: fetchResult.value,
      fromCache: false,
      metadata: {
        operationTimeMs,
        cacheHit: false,
        retryAttempted,
        retryCount
      }
    });

  } catch (error) {
    const operationTimeMs = Date.now() - startTime;
    config.get('logger')?.error('Unexpected error in cacheItem', { 
      key, 
      error, 
      operationTimeMs 
    });
    
    return Err(createCacheError(
      `Unexpected error in cacheItem for key "${key}": ${error}`,
      CacheErrorCode.FETCH_FAILED,
      { key, error, operationTimeMs }
    ));
  }
}

/**
 * Simplified cache function that returns just the value (backward compatibility)
 */
export async function simpleCacheItem<V>(input: CacheItemInput<V>): Promise<Result<V, any>> {
  const result = await cacheItem(input);
  
  if (result.ok) {
    return Ok(result.value.value);
  }
  
  return result;
}

/**
 * Cache with automatic invalidation after a set time
 */
export async function cacheWithInvalidation<V>(
  input: CacheItemInput<V> & { invalidateAfterMs: number }
): Promise<Result<V, any>> {
  const { invalidateAfterMs, ...cacheInput } = input;
  
  // Check if we need to invalidate
  const metadataResult = await input.store.getWithMetadata(input.key);
  
  if (metadataResult.ok && metadataResult.value) {
    const age = Date.now() - metadataResult.value.metadata.createdAt;
    if (age > invalidateAfterMs) {
      // Invalidate by deleting the key
      await input.store.delete(input.key);
    }
  }
  
  const result = await simpleCacheItem(cacheInput);
  return result;
}

/**
 * Cache multiple items at once
 */
export async function cacheMultipleItems<V>(
  inputs: Array<CacheItemInput<V>>
): Promise<Result<Map<string, CacheResult<V>>, any>> {
  const results = new Map<string, CacheResult<V>>();
  const errors: Array<{ key: string; error: any }> = [];
  
  // Process all cache operations in parallel
  const promises = inputs.map(async (input) => {
    const result = await cacheItem(input);
    if (result.ok) {
      results.set(input.key, result.value);
    } else {
      errors.push({ key: input.key, error: result.error });
    }
  });
  
  await Promise.all(promises);
  
  if (errors.length > 0) {
    return Err(createCacheError(
      `Failed to cache ${errors.length} out of ${inputs.length} items`,
      CacheErrorCode.FETCH_FAILED,
      { errors, successCount: results.size }
    ));
  }
  
  return Ok(results);
}