import { injectable, inject } from 'inversify';
import 'reflect-metadata';

import type { IKeyValueStore } from '../core/contracts/key-value-store';
import type { Logger, ConfigManager, MemoryStoreConfig, RedisStoreConfig } from '../core/config';
import { InMemoryStore } from '../infra/memory/in-memory-store';
import { EnhancedMemoryStore } from '../infra/memory/enhanced-memory-store';
import { RedisStore } from '../infra/redis/redis-store';
import { NamespacedStore } from '../infra/decorators/namespaced-store';
import { MultiTierStore } from '../infra/hybrid/multi-tier-store';
import type { MultiTierConfig } from '../infra/hybrid/multi-tier-store';
import { TYPES } from '../di/types';

/**
 * Store type enumeration
 */
export enum StoreType {
  MEMORY = 'memory',
  ENHANCED_MEMORY = 'enhanced-memory',
  REDIS = 'redis',
  NAMESPACED = 'namespaced',
  MULTI_TIER = 'multi-tier'
}

/**
 * Store creation options
 */
export interface StoreOptions<V = unknown> {
  type: StoreType;
  namespace?: string;
  memoryConfig?: Partial<MemoryStoreConfig>;
  redisConfig?: Partial<RedisStoreConfig>;
  multiTierConfig?: {
    l1Type: StoreType.MEMORY | StoreType.ENHANCED_MEMORY;
    l2Type: StoreType.REDIS;
    config?: MultiTierConfig;
  };
}

/**
 * Injectable factory service for creating cache stores
 */
@injectable()
export class StoreFactory {
  private readonly logger: Logger;
  private readonly config: ConfigManager;

  constructor(
    @inject(TYPES.Logger) logger: Logger,
    @inject(TYPES.ConfigManager) config: ConfigManager
  ) {
    this.logger = logger;
    this.config = config;
  }

  /**
   * Creates a store instance based on the provided options
   */
  public createStore<V = unknown>(options: StoreOptions<V>): IKeyValueStore<V> {
    this.logger.debug('Creating store', { type: options.type, namespace: options.namespace });

    let baseStore: IKeyValueStore<V>;

    switch (options.type) {
      case StoreType.MEMORY:
        baseStore = this.createMemoryStore<V>();
        break;

      case StoreType.ENHANCED_MEMORY:
        baseStore = this.createEnhancedMemoryStore<V>(options.memoryConfig);
        break;

      case StoreType.REDIS:
        baseStore = this.createRedisStore<V>(options.redisConfig);
        break;

      case StoreType.MULTI_TIER:
        if (!options.multiTierConfig) {
          throw new Error('Multi-tier config is required for multi-tier store');
        }
        baseStore = this.createMultiTierStore<V>(options.multiTierConfig);
        break;

      case StoreType.NAMESPACED: {
        if (!options.namespace) {
          throw new Error('Namespace is required for namespaced store');
        }
        // For namespaced stores, create the base store based on configuration
        const baseStoreType: StoreType = this.getDefaultStoreType();
        const baseOptions: StoreOptions<V> = { ...options, type: baseStoreType };
        delete baseOptions.namespace; // Remove namespace from base options
        
        const innerStore: IKeyValueStore<V> = this.createStore(baseOptions);
        baseStore = new NamespacedStore<V>(innerStore, options.namespace);
        break;
      }

      default:
        throw new Error(`Unsupported store type: ${options.type}`);
    }

    this.logger.info('Store created successfully', { 
      type: options.type, 
      namespace: options.namespace,
      hasNamespace: !!options.namespace 
    });

    return baseStore;
  }

  /**
   * Creates a basic in-memory store
   */
  private createMemoryStore<V>(): IKeyValueStore<V> {
    return new InMemoryStore<V>();
  }

  /**
   * Creates an enhanced memory store with configuration
   */
  private createEnhancedMemoryStore<V>(customConfig?: Partial<MemoryStoreConfig>): IKeyValueStore<V> {
    const defaultConfig: MemoryStoreConfig | undefined = this.config.get('stores')?.memory;
    const finalConfig: Partial<MemoryStoreConfig> = {
      ...defaultConfig,
      ...customConfig
    };

    return new EnhancedMemoryStore<V>(finalConfig);
  }

  /**
   * Creates a Redis store with configuration
   */
  private createRedisStore<V>(customConfig?: Partial<RedisStoreConfig>): IKeyValueStore<V> {
    const defaultConfig: RedisStoreConfig | undefined = this.config.get('stores')?.redis;
    const finalConfig: Partial<RedisStoreConfig> = {
      ...defaultConfig,
      ...customConfig
    };

    return new RedisStore<V>(finalConfig);
  }

  /**
   * Creates a multi-tier store combining L1 and L2 caches
   */
  private createMultiTierStore<V>(config: {
    l1Type: StoreType.MEMORY | StoreType.ENHANCED_MEMORY;
    l2Type: StoreType.REDIS;
    config?: MultiTierConfig;
  }): IKeyValueStore<V> {
    // Create L1 cache (memory-based)
    let l1Cache: IKeyValueStore<V>;
    if (config.l1Type === StoreType.MEMORY) {
      l1Cache = this.createMemoryStore<V>();
    } else {
      l1Cache = this.createEnhancedMemoryStore<V>();
    }

    // Create L2 cache (Redis-based)
    const l2Cache: IKeyValueStore<V> = this.createRedisStore<V>();

    // Create multi-tier store
    return new MultiTierStore<V>(l1Cache, l2Cache, config.config);
  }

  /**
   * Creates a namespaced store wrapper around another store
   */
  public createNamespacedStore<V>(
    innerStore: IKeyValueStore<V>, 
    namespace: string
  ): IKeyValueStore<V> {
    this.logger.debug('Creating namespaced store', { namespace });
    return new NamespacedStore<V>(innerStore, namespace);
  }

  /**
   * Creates a store from a configuration string (e.g., "redis://localhost:6379")
   */
  public createStoreFromUrl<V>(url: string, namespace?: string): IKeyValueStore<V> {
    this.logger.debug('Creating store from URL', { url: url.split('://')[0] + '://***', namespace });

    let store: IKeyValueStore<V>;

    if (url.startsWith('redis://') || url.startsWith('rediss://')) {
      // Parse Redis URL
      const redisConfig: Partial<RedisStoreConfig> = { url };
      store = this.createRedisStore<V>(redisConfig);
    } else if (url.startsWith('memory://')) {
      // Parse memory URL (custom format)
      const urlObj: URL = new URL(url);
      const maxMemoryMB: number = parseInt(urlObj.searchParams.get('maxMemoryMB') || '50', 10);
      const ttlMs: number = parseInt(urlObj.searchParams.get('ttlMs') || '300000', 10);
      
      const memoryConfig: Partial<MemoryStoreConfig> = {
        maxMemoryBytes: maxMemoryMB * 1024 * 1024,
        cleanupIntervalMs: ttlMs / 10,
        autoCleanup: true
      };
      
      store = this.createEnhancedMemoryStore<V>(memoryConfig);
    } else {
      throw new Error(`Unsupported store URL format: ${url}`);
    }

    // Wrap in namespace if provided
    if (namespace) {
      store = this.createNamespacedStore(store, namespace);
    }

    return store;
  }

  /**
   * Gets the default store type from configuration
   */
  private getDefaultStoreType(): StoreType {
    // Check if Redis is configured and available
    const redisConfig: RedisStoreConfig | undefined = this.config.get('stores')?.redis;
    if (redisConfig?.host || redisConfig?.url) {
      return StoreType.REDIS;
    }

    // Fall back to enhanced memory
    return StoreType.ENHANCED_MEMORY;
  }

  /**
   * Creates a store optimized for the current environment
   */
  public createOptimizedStore<V>(namespace?: string): IKeyValueStore<V> {
    const storeType: StoreType = this.getDefaultStoreType();
    const options: StoreOptions<V> = {
      type: storeType,
      namespace
    };

    this.logger.info('Creating optimized store', { type: storeType, namespace });
    return this.createStore(options);
  }

  /**
   * Creates a high-performance multi-tier store for production use
   */
  public createProductionStore<V>(namespace?: string): IKeyValueStore<V> {
    const options: StoreOptions<V> = {
      type: StoreType.MULTI_TIER,
      namespace,
      multiTierConfig: {
        l1Type: StoreType.ENHANCED_MEMORY,
        l2Type: StoreType.REDIS,
        config: {
          l1TtlMs: 2 * 60 * 1000,      // 2 minutes in L1
          l2TtlMs: 30 * 60 * 1000,     // 30 minutes in L2
          populateL1OnL2Hit: true,
          writeThrough: true,
          writeBehind: false
        }
      }
    };

    this.logger.info('Creating production store', { namespace });
    return this.createStore(options);
  }
}
