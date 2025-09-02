/**
 * Examples demonstrating different caching strategies with eGenome-Libs
 * 
 * This file shows how to use:
 * 1. In-memory caching (basic & enhanced)
 * 2. Redis caching  
 * 3. Multi-tier caching (memory + Redis)
 * 4. Namespaced caching
 * 5. Advanced cache patterns
 */

import {
  // Store implementations
  InMemoryStore,
  EnhancedMemoryStore,
  RedisStore,
  MultiTierStore,
  NamespacedStore,
  
  // Cache functions
  cacheItem,
  simpleCacheItem,
  cacheMultipleItems,
  
  // Configuration
  createConfig,
  ConsoleLogger,
  
  // Types
  type MultiTierConfig,
  type CacheItemInput
} from '../src';

// Example user data interface
interface User {
  id: string;
  name: string;
  email: string;
  lastLogin: Date;
}

/**
 * 1. Basic In-Memory Caching
 */
async function basicMemoryCacheExample() {
  console.log('\n=== Basic Memory Cache Example ===');
  
  const cache = new InMemoryStore<User>();
  
  const getUser = async (id: string): Promise<User> => {
    console.log(`Fetching user ${id} from database...`);
    // Simulate database call
    await new Promise(resolve => setTimeout(resolve, 100));
    return {
      id,
      name: `User ${id}`,
      email: `user${id}@example.com`,
      lastLogin: new Date()
    };
  };

  // Cache user data
  const result = await simpleCacheItem({
    store: cache,
    key: 'user:123',
    fetcher: () => getUser('123')
  });

  if (result.ok) {
    console.log('User:', result.value);
  }

  // Second call should be cached
  const cached = await simpleCacheItem({
    store: cache,
    key: 'user:123',
    fetcher: () => getUser('123')
  });

  if (cached.ok) {
    console.log('Cached user:', cached.value);
  }
}

/**
 * 2. Enhanced Memory Cache with TTL and Statistics
 */
async function enhancedMemoryCacheExample() {
  console.log('\n=== Enhanced Memory Cache Example ===');
  
  const cache = new EnhancedMemoryStore<User>({
    maxMemoryBytes: 10 * 1024 * 1024, // 10MB
    cleanupIntervalMs: 30 * 1000, // 30 seconds
    autoCleanup: true
  });

  const fetchUser = async (id: string): Promise<User> => {
    console.log(`Fetching user ${id} from API...`);
    return {
      id,
      name: `Enhanced User ${id}`,
      email: `enhanced${id}@example.com`,
      lastLogin: new Date()
    };
  };

  // Cache with TTL and detailed results
  const result = await cacheItem({
    store: cache,
    key: 'user:456',
    fetcher: () => fetchUser('456'),
    options: {
      ttlMs: 60 * 1000, // 1 minute
      maxRetries: 3,
      retryDelayMs: 500
    }
  });

  if (result.ok) {
    console.log('Enhanced cache result:', {
      value: result.value.value,
      fromCache: result.value.fromCache,
      operationTime: result.value.metadata.operationTimeMs,
      cacheHit: result.value.metadata.cacheHit
    });
  }

  // Get cache statistics
  const stats = await cache.getStats();
  if (stats.ok) {
    console.log('Cache statistics:', {
      keyCount: stats.value.keyCount,
      hitRatio: stats.value.hitRatio,
      memoryUsage: `${Math.round(stats.value.memoryUsageBytes / 1024)}KB`
    });
  }

  // Clean up
  cache.destroy();
}

/**
 * 3. Redis Cache Example
 */
async function redisCacheExample() {
  console.log('\n=== Redis Cache Example ===');
  
  // Configure Redis connection
  const config = createConfig({
    debug: true,
    logger: new ConsoleLogger(true),
    stores: {
      redis: {
        host: 'localhost',
        port: 6379,
        // password: 'your-redis-password',
        db: 0,
        connectTimeoutMs: 5000,
        commandTimeoutMs: 3000
      }
    }
  });

  const redisCache = new RedisStore<User>(config.get('stores')?.redis);

  const fetchUserFromDB = async (id: string): Promise<User> => {
    console.log(`Fetching user ${id} from database...`);
    await new Promise(resolve => setTimeout(resolve, 200));
    return {
      id,
      name: `Redis User ${id}`,
      email: `redis${id}@example.com`,
      lastLogin: new Date()
    };
  };

  try {
    // Test Redis connection
    const pingResult = await redisCache.ping();
    if (!pingResult.ok || !pingResult.value) {
      console.log('Redis not available, skipping Redis example');
      return;
    }

    // Cache with Redis
    const result = await cacheItem({
      store: redisCache,
      key: 'user:redis:789',
      fetcher: () => fetchUserFromDB('789'),
      options: {
        ttlMs: 5 * 60 * 1000, // 5 minutes
        maxRetries: 2
      }
    });

    if (result.ok) {
      console.log('Redis cache result:', {
        value: result.value.value,
        fromCache: result.value.fromCache
      });
    }

    // Batch operations
    const batchInputs: CacheItemInput<User>[] = [
      { store: redisCache, key: 'user:batch:1', fetcher: () => fetchUserFromDB('batch1') },
      { store: redisCache, key: 'user:batch:2', fetcher: () => fetchUserFromDB('batch2') },
      { store: redisCache, key: 'user:batch:3', fetcher: () => fetchUserFromDB('batch3') }
    ];

    const batchResult = await cacheMultipleItems(batchInputs);
    if (batchResult.ok) {
      console.log(`Cached ${batchResult.value.size} users in batch operation`);
    }

    // Clean up
    await redisCache.destroy();

  } catch (error) {
    console.log('Redis cache error (Redis might not be running):', error);
  }
}

/**
 * 4. Multi-Tier Cache (Memory + Redis)
 */
async function multiTierCacheExample() {
  console.log('\n=== Multi-Tier Cache Example ===');
  
  // L1: Fast memory cache
  const l1Cache = new EnhancedMemoryStore<User>({
    maxMemoryBytes: 5 * 1024 * 1024, // 5MB
    cleanupIntervalMs: 30 * 1000
  });

  // L2: Persistent Redis cache
  const l2Cache = new RedisStore<User>({
    host: 'localhost',
    port: 6379,
    db: 1 // Different DB for L2
  });

  // Multi-tier configuration
  const multiTierConfig: MultiTierConfig = {
    l1TtlMs: 2 * 60 * 1000, // L1: 2 minutes
    l2TtlMs: 30 * 60 * 1000, // L2: 30 minutes  
    populateL1OnL2Hit: true, // Promote L2 hits to L1
    writeThrough: true, // Write to both tiers synchronously
    writeBehind: false // Alternative: async L2 writes
  };

  const multiTierCache = new MultiTierStore(l1Cache, l2Cache, multiTierConfig);

  const fetchExpensiveData = async (id: string): Promise<User> => {
    console.log(`Expensive computation for user ${id}...`);
    await new Promise(resolve => setTimeout(resolve, 500)); // Simulate expensive operation
    return {
      id,
      name: `Computed User ${id}`,
      email: `computed${id}@example.com`,
      lastLogin: new Date()
    };
  };

  try {
    // Test if Redis is available
    const pingResult = await l2Cache.ping();
    if (!pingResult.ok || !pingResult.value) {
      console.log('Redis not available, skipping multi-tier example');
      return;
    }

    // Cache with multi-tier
    const result = await cacheItem({
      store: multiTierCache,
      key: 'user:expensive:999',
      fetcher: () => fetchExpensiveData('999'),
      options: {
        ttlMs: 10 * 60 * 1000, // 10 minutes
        maxRetries: 2
      }
    });

    if (result.ok) {
      console.log('Multi-tier cache result:', {
        value: result.value.value,
        fromCache: result.value.fromCache,
        operationTime: result.value.metadata.operationTimeMs
      });
    }

    // Second access should hit L1 (sub-millisecond)
    const fastResult = await cacheItem({
      store: multiTierCache,
      key: 'user:expensive:999',
      fetcher: () => fetchExpensiveData('999')
    });

    if (fastResult.ok) {
      console.log('Fast L1 hit:', {
        fromCache: fastResult.value.fromCache,
        operationTime: fastResult.value.metadata.operationTimeMs
      });
    }

    // Get combined statistics
    const stats = await multiTierCache.getStats();
    if (stats.ok) {
      console.log('Multi-tier stats:', {
        keyCount: stats.value.keyCount,
        hitRatio: stats.value.hitRatio,
        totalHits: stats.value.hits
      });
    }

    // Clean up
    await multiTierCache.destroy();

  } catch (error) {
    console.log('Multi-tier cache error:', error);
  }
}

/**
 * 5. Namespaced Cache Example
 */
async function namespacedCacheExample() {
  console.log('\n=== Namespaced Cache Example ===');
  
  const baseCache = new EnhancedMemoryStore<any>();
  
  // Create different namespaces for different data types
  const userCache = new NamespacedStore(baseCache, 'users');
  const sessionCache = new NamespacedStore(baseCache, 'sessions');
  const productCache = new NamespacedStore(baseCache, 'products');

  // Cache different types of data without key conflicts
  await userCache.set('123', { id: '123', name: 'John Doe' });
  await sessionCache.set('123', { sessionId: '123', userId: 'user456', expires: new Date() });
  await productCache.set('123', { id: '123', name: 'Widget', price: 29.99 });

  // Retrieve namespaced data
  const user = await userCache.get('123');
  const session = await sessionCache.get('123');
  const product = await productCache.get('123');

  console.log('Namespaced data:');
  if (user.ok) console.log('User 123:', user.value);
  if (session.ok) console.log('Session 123:', session.value);
  if (product.ok) console.log('Product 123:', product.value);

  // List keys by namespace
  const userKeys = await userCache.keys();
  const sessionKeys = await sessionCache.keys();
  
  if (userKeys.ok) console.log('User keys:', userKeys.value);
  if (sessionKeys.ok) console.log('Session keys:', sessionKeys.value);

  baseCache.destroy();
}

/**
 * 6. Advanced Cache Patterns
 */
async function advancedCachePatternsExample() {
  console.log('\n=== Advanced Cache Patterns Example ===');
  
  const cache = new EnhancedMemoryStore<any>();

  // Cache-aside pattern with retry and fallback
  const getProductWithFallback = async (id: string) => {
    return cacheItem({
      store: cache,
      key: `product:${id}`,
      fetcher: async () => {
        // Simulate API that might fail
        if (Math.random() > 0.7) {
          throw new Error('API temporarily unavailable');
        }
        return { id, name: `Product ${id}`, price: Math.random() * 100 };
      },
      options: {
        ttlMs: 5 * 60 * 1000, // 5 minutes
        maxRetries: 3,
        retryDelayMs: 1000,
        defaultValue: { id, name: 'Product Unavailable', price: 0 } // Fallback value
      }
    });
  };

  // Attempt to get product with retry and fallback
  const productResult = await getProductWithFallback('advanced-123');
  if (productResult.ok) {
    console.log('Product with fallback:', {
      product: productResult.value.value,
      fromCache: productResult.value.fromCache,
      retryAttempted: productResult.value.metadata.retryAttempted,
      retryCount: productResult.value.metadata.retryCount
    });
  }

  // Write-behind pattern simulation
  const writeBackCache = async (key: string, data: any) => {
    // Immediately cache the data
    await cache.set(key, data, { ttlMs: 60 * 1000 });
    
    // Asynchronously persist to database (simulated)
    setTimeout(async () => {
      console.log(`Background: Persisting ${key} to database...`);
      // Simulate database write
      await new Promise(resolve => setTimeout(resolve, 100));
      console.log(`Background: ${key} persisted successfully`);
    }, 1000);
  };

  await writeBackCache('user:write-behind:456', {
    id: '456',
    name: 'Write-Behind User',
    updatedAt: new Date()
  });

  cache.destroy();
}

/**
 * Run all examples
 */
async function runAllExamples() {
  console.log('🚀 eGenome-Libs Cache Strategy Examples\n');
  
  try {
    await basicMemoryCacheExample();
    await enhancedMemoryCacheExample();
    await redisCacheExample();
    await multiTierCacheExample();
    await namespacedCacheExample();
    await advancedCachePatternsExample();
    
    console.log('\n✅ All examples completed successfully!');
  } catch (error) {
    console.error('\n❌ Example failed:', error);
  }
}

// Export for use in other files
export {
  basicMemoryCacheExample,
  enhancedMemoryCacheExample,
  redisCacheExample,
  multiTierCacheExample,
  namespacedCacheExample,
  advancedCachePatternsExample,
  runAllExamples
};

// Run examples if this file is executed directly
if (require.main === module) {
  runAllExamples();
}
