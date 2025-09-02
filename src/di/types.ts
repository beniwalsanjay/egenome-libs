/**
 * Dependency injection types and identifiers for eGenome-Libs
 */

export const TYPES = {
  // Core services
  Logger: Symbol.for('Logger'),
  ConfigManager: Symbol.for('ConfigManager'),
  
  // Store implementations
  IKeyValueStore: Symbol.for('IKeyValueStore'),
  InMemoryStore: Symbol.for('InMemoryStore'),
  EnhancedMemoryStore: Symbol.for('EnhancedMemoryStore'),
  RedisStore: Symbol.for('RedisStore'),
  NamespacedStore: Symbol.for('NamespacedStore'),
  MultiTierStore: Symbol.for('MultiTierStore'),
  
  // Configuration
  EGenomeConfig: Symbol.for('EGenomeConfig'),
  MemoryStoreConfig: Symbol.for('MemoryStoreConfig'),
  RedisStoreConfig: Symbol.for('RedisStoreConfig'),
  
  // Cache services
  CacheService: Symbol.for('CacheService'),
  CacheItemService: Symbol.for('CacheItemService'),
  
  // Factory services
  StoreFactory: Symbol.for('StoreFactory'),
  CacheFactory: Symbol.for('CacheFactory')
} as const;

export type DITypes = typeof TYPES;
