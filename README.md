# @beniwalsanjay/egenome-libs

A comprehensive, production-ready TypeScript library for building scalable caching solutions with SOLID principles.

## 🚀 Features

- **🏗️ SOLID Architecture**: Clean, maintainable design following SOLID principles
- **🔄 Multiple Store Implementations**: In-memory, Redis, multi-tier caching, enhanced memory with LRU eviction
- **⏰ TTL Support**: Time-to-live functionality with automatic expiration
- **📊 Advanced Statistics**: Detailed cache performance metrics
- **🔧 Batch Operations**: Efficient multi-key operations
- **🛡️ Robust Error Handling**: Comprehensive error types and handling
- **🎯 Result Type**: Functional programming approach with Result<T, E>
- **⚙️ Configuration Management**: Flexible, type-safe configuration system
- **📝 Comprehensive Logging**: Built-in logging with custom logger support
- **🧪 Extensively Tested**: 90%+ test coverage with comprehensive test suite
- **📦 Tree-shakable**: Import only what you need
- **🔍 TypeScript First**: Full TypeScript support with excellent IntelliSense

## 📦 Installation

```bash
npm install @beniwalsanjay/egenome-libs
```

### Optional Dependencies

For Redis support:
```bash
npm install ioredis
npm install --save-dev @types/ioredis
```

For Memcached support (if you implement MemcachedStore):
```bash
npm install memcached
npm install --save-dev @types/memcached
```

## 🏃 Quick Start

### Basic Cache Usage

```typescript
import { InMemoryStore, simpleCacheItem } from '@beniwalsanjay/egenome-libs';

const store = new InMemoryStore<string>();

const result = await simpleCacheItem({
  store,
  key: 'user:123',
  fetcher: async () => {
    // Simulate API call
    return 'User data from API';
  }
});

if (result.ok) {
  console.log(result.value); // "User data from API"
}
```

### Enhanced Cache with TTL and Statistics

```typescript
import { EnhancedMemoryStore, cacheItem } from '@beniwalsanjay/egenome-libs';

const store = new EnhancedMemoryStore<UserData>();

const result = await cacheItem({
  store,
  key: 'user:123',
  fetcher: async () => fetchUserFromAPI('123'),
  options: {
    ttlMs: 5 * 60 * 1000, // 5 minutes
    maxRetries: 3,
    retryDelayMs: 1000
  }
});

if (result.ok) {
  console.log(`Value: ${result.value.value}`);
  console.log(`From cache: ${result.value.fromCache}`);
  console.log(`Operation took: ${result.value.metadata.operationTimeMs}ms`);
}

// Get cache statistics
const stats = await store.getStats();
if (stats.ok) {
  console.log(`Hit ratio: ${stats.value.hitRatio}`);
  console.log(`Total keys: ${stats.value.keyCount}`);
}
```

### Namespaced Store

```typescript
import { InMemoryStore, NamespacedStore } from '@beniwalsanjay/egenome-libs';

const baseStore = new InMemoryStore();
const userCache = new NamespacedStore(baseStore, 'users');
const productCache = new NamespacedStore(baseStore, 'products');

// Keys are automatically prefixed
await userCache.set('123', { name: 'John' });
await productCache.set('123', { title: 'Widget' });

// No key conflicts - they're stored as 'users:123' and 'products:123'
```

### Redis Cache

```typescript
import { RedisStore, cacheItem } from '@beniwalsanjay/egenome-libs';

const redisStore = new RedisStore<UserData>({
  host: 'localhost',
  port: 6379,
  password: 'your-password',
  db: 0
});

const result = await cacheItem({
  store: redisStore,
  key: 'user:123',
  fetcher: async () => fetchUserFromDatabase('123'),
  options: {
    ttlMs: 10 * 60 * 1000, // 10 minutes
    maxRetries: 3
  }
});
```

### Multi-Tier Cache (Memory + Redis)

```typescript
import { 
  EnhancedMemoryStore, 
  RedisStore, 
  MultiTierStore,
  cacheItem 
} from '@beniwalsanjay/egenome-libs';

// L1: Fast memory cache
const l1Cache = new EnhancedMemoryStore<UserData>();

// L2: Persistent Redis cache  
const l2Cache = new RedisStore<UserData>({
  host: 'localhost',
  port: 6379
});

// Multi-tier with read-through and write-through
const multiTierCache = new MultiTierStore(l1Cache, l2Cache, {
  l1TtlMs: 2 * 60 * 1000,      // L1: 2 minutes (fast access)
  l2TtlMs: 30 * 60 * 1000,     // L2: 30 minutes (persistence)
  populateL1OnL2Hit: true,     // Promote L2 hits to L1
  writeThrough: true           // Write to both tiers
});

const result = await cacheItem({
  store: multiTierCache,
  key: 'user:123',
  fetcher: async () => expensiveOperation('123')
});

// First call: Fetches data, stores in both L1 and L2
// Second call: Sub-millisecond response from L1
// L1 eviction: Still fast response from L2, re-populates L1
```

## 📚 Core Concepts

### Result Type

All operations return a `Result<T, E>` type for functional error handling:

```typescript
import { Ok, Err, ResultUtils } from '@beniwalsanjay/egenome-libs';

const result = await store.get('key');

if (result.ok) {
  // Type-safe access to value
  console.log(result.value);
} else {
  // Handle error
  console.error(result.error);
}

// Functional programming patterns
const doubled = ResultUtils.map(result, x => x * 2);
const combined = ResultUtils.all([result1, result2, result3]);
```

### Error Handling

Comprehensive error types with context:

```typescript
import { 
  isStoreError, 
  isCacheError, 
  StoreErrorCode,
  CacheErrorCode 
} from '@beniwalsanjay/egenome-libs';

const result = await store.get('key');
if (!result.ok) {
  if (isStoreError(result.error)) {
    if (result.error.code === StoreErrorCode.CONNECTION_FAILED) {
      // Handle connection error
    }
  }
}
```

### Configuration

Flexible configuration system:

```typescript
import { createConfig, EnhancedMemoryStore } from '@beniwalsanjay/egenome-libs';

const config = createConfig({
  defaultTtlMs: 10 * 60 * 1000, // 10 minutes
  debug: true,
  stores: {
    memory: {
      maxMemoryBytes: 100 * 1024 * 1024, // 100MB
      cleanupIntervalMs: 30 * 1000 // 30 seconds
    }
  }
});

const store = new EnhancedMemoryStore(config.get('stores')?.memory);
```

## 🛠️ API Reference

### Store Interfaces

#### `IKeyValueStore<V>`
Core interface for all stores:
- `get(key, options?)` - Retrieve a value
- `set(key, value, options?)` - Store a value
- `has(key)` - Check if key exists
- `delete(key)` - Remove a key
- `clear()` - Remove all keys
- `mget(keys, options?)` - Get multiple values
- `mset(operations)` - Set multiple values
- `keys(pattern?)` - List keys
- `getStats()` - Get store statistics

#### `IEvictableStore<V>`
Extended interface for stores with eviction:
- `evict(count?)` - Manually evict items
- `getLruKeys(count)` - Get least recently used keys
- `getLfuKeys(count)` - Get least frequently used keys

### Store Implementations

#### `InMemoryStore<V>`
Basic in-memory implementation:
```typescript
const store = new InMemoryStore<string>();
```

#### `EnhancedMemoryStore<V>`
Advanced in-memory store with TTL, LRU eviction, and statistics:
```typescript
const store = new EnhancedMemoryStore<UserData>({
  maxMemoryBytes: 50 * 1024 * 1024,
  cleanupIntervalMs: 60 * 1000,
  autoCleanup: true
});
```

#### `NamespacedStore<V>`
Decorator for adding namespaces:
```typescript
const namespacedStore = new NamespacedStore(baseStore, 'namespace');
```

#### `RedisStore<V>`
Production-ready Redis implementation:
```typescript
const redisStore = new RedisStore<UserData>({
  host: 'localhost',
  port: 6379,
  password: 'secret',
  db: 0,
  connectTimeoutMs: 5000,
  commandTimeoutMs: 3000
});
```

#### `MultiTierStore<V>`
Multi-tier cache combining memory and external storage:
```typescript
const multiTierStore = new MultiTierStore(memoryCache, redisCache, {
  l1TtlMs: 60 * 1000,
  l2TtlMs: 600 * 1000,
  writeThrough: true,
  populateL1OnL2Hit: true
});
```

### Cache Functions

#### `cacheItem<V>(input)`
Advanced cache function with detailed results:
```typescript
const result = await cacheItem({
  store,
  key: 'cache-key',
  fetcher: async () => 'value',
  options: {
    ttlMs: 300000,
    maxRetries: 3,
    retryDelayMs: 1000,
    defaultValue: 'fallback'
  }
});
```

#### `simpleCacheItem<V>(input)`
Simplified cache function (backward compatible):
```typescript
const result = await simpleCacheItem({
  store,
  key: 'cache-key',
  fetcher: async () => 'value'
});
```

#### `cacheWithInvalidation<V>(input)`
Cache with automatic invalidation:
```typescript
const result = await cacheWithInvalidation({
  store,
  key: 'cache-key',
  fetcher: async () => 'value',
  invalidateAfterMs: 300000
});
```

#### `cacheMultipleItems<V>(inputs)`
Batch cache operations:
```typescript
const results = await cacheMultipleItems([
  { store, key: 'key1', fetcher: () => 'value1' },
  { store, key: 'key2', fetcher: () => 'value2' }
]);
```

## 🧪 Testing

Run the comprehensive test suite:

```bash
npm test
```

Run tests in watch mode:

```bash
npm run test:watch
```

## 📝 Examples

### Real-world Usage Example

```typescript
import { 
  EnhancedMemoryStore, 
  NamespacedStore, 
  cacheItem,
  createConfig,
  ConsoleLogger 
} from '@beniwalsanjay/egenome-libs';

// Configure the library
const config = createConfig({
  debug: true,
  defaultTtlMs: 5 * 60 * 1000,
  logger: new ConsoleLogger(true),
  stores: {
    memory: {
      maxMemoryBytes: 100 * 1024 * 1024,
      cleanupIntervalMs: 60 * 1000
    }
  }
});

// Create stores
const baseStore = new EnhancedMemoryStore(config.get('stores')?.memory);
const userStore = new NamespacedStore(baseStore, 'users');
const sessionStore = new NamespacedStore(baseStore, 'sessions');

// Cache user data
async function getUser(id: string) {
  return cacheItem({
    store: userStore,
    key: id,
    fetcher: async () => {
      const response = await fetch(`/api/users/${id}`);
      return response.json();
    },
    options: {
      ttlMs: 10 * 60 * 1000, // 10 minutes
      maxRetries: 2,
      retryDelayMs: 500
    }
  });
}

// Cache session data with shorter TTL
async function getSession(token: string) {
  return cacheItem({
    store: sessionStore,
    key: token,
    fetcher: async () => validateSessionToken(token),
    options: {
      ttlMs: 5 * 60 * 1000, // 5 minutes
      refreshTtl: true // Refresh TTL on access
    }
  });
}

// Monitor cache performance
setInterval(async () => {
  const stats = await baseStore.getStats();
  if (stats.ok) {
    console.log(`Cache stats:`, {
      hitRatio: stats.value.hitRatio,
      keyCount: stats.value.keyCount,
      memoryUsage: `${Math.round(stats.value.memoryUsageBytes / 1024)}KB`
    });
  }
}, 30000);
```

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch: `git checkout -b feature/my-new-feature`
3. Commit your changes: `git commit -am 'Add some feature'`
4. Push to the branch: `git push origin feature/my-new-feature`
5. Submit a pull request

## 📄 License

This project is licensed under the ISC License - see the [LICENSE](LICENSE) file for details.

## 🆕 Changelog

### v1.0.0 (Latest)
- ✨ Complete refactor with SOLID principles
- ✨ Enhanced memory store with LRU eviction
- ✨ TTL support with automatic expiration
- ✨ **Redis integration** with production-ready features
- ✨ **Multi-tier caching** (Memory + Redis/External)
- ✨ **Advanced cache strategies** (read-through, write-through, write-behind)
- ✨ Comprehensive error handling with custom error types
- ✨ Result type for functional programming
- ✨ Configuration management system
- ✨ Advanced statistics and monitoring
- ✨ Batch operations support
- ✨ Namespaced store decorator
- ✨ Multiple cache strategies
- ✨ Extensive test coverage (90%+)
- ✨ Complete TypeScript rewrite
- ✨ Performance optimizations