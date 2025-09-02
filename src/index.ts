// Core functionality
export * from "./core/contracts/key-value-store";
export * from "./core/result";
export * from "./core/errors";
export * from "./core/config";

// Dependency Injection
export * from "./di/types";
export * from "./di/container";

// Services
export * from "./services/cache-item.service";
export * from "./services/store.factory";

// Infrastructure implementations
export * from "./infra/memory/in-memory-store";
export * from "./infra/memory/enhanced-memory-store";
export * from "./infra/decorators/namespaced-store";
export * from "./infra/redis/redis-store";
export * from "./infra/hybrid/multi-tier-store";

// Use cases
export * from "./use-cases/cache-item";

// Re-export commonly used types and functions for convenience
export type {
  IKeyValueStore,
  IEvictableStore,
  ITransactionalStore,
  IObservableStore,
  SetOptions,
  GetOptions,
  ValueMetadata,
  StoredValue,
  BatchSetOperation,
  BatchResult,
  StoreStats,
  StoreEvent
} from "./core/contracts/key-value-store";

export type {
  Result,
  Success,
  Failure
} from "./core/result";

export {
  Ok,
  Err,
  ResultUtils
} from "./core/result";

export type {
  EGenomeError,
  CacheError,
  StoreError,
  ValidationError
} from "./core/errors";

export {
  CacheErrorCode,
  StoreErrorCode,
  ValidationErrorCode,
  createCacheError,
  createStoreError,
  createValidationError,
  isEGenomeError,
  isCacheError,
  isStoreError,
  isValidationError
} from "./core/errors";

export type {
  EGenomeConfig,
  MemoryStoreConfig,
  RedisStoreConfig,
  Logger
} from "./core/config";

export {
  DEFAULT_CONFIG,
  ConfigManager,
  ConsoleLogger,
  NoOpLogger,
  createConfig,
  getGlobalConfig
} from "./core/config";

export type {
  CacheItemInput,
  CacheItemOptions,
  CacheResult
} from "./use-cases/cache-item";

export type {
  MultiTierConfig
} from "./infra/hybrid/multi-tier-store";

export type {
  DITypes
} from "./di/types";

export type {
  StoreOptions,
  StoreType
} from "./services/store.factory";

export type {
  CacheItemInput as ServiceCacheItemInput,
  CacheItemOptions as ServiceCacheItemOptions,
  CacheResult as ServiceCacheResult
} from "./services/cache-item.service";

export {
  cacheItem,
  simpleCacheItem,
  cacheWithInvalidation,
  cacheMultipleItems
} from "./use-cases/cache-item";