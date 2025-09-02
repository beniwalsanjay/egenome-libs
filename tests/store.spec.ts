import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { 
  InMemoryStore, 
  EnhancedMemoryStore,
  NamespacedStore, 
  cacheItem,
  simpleCacheItem,
  cacheWithInvalidation,
  cacheMultipleItems,
  Ok,
  Err,
  ResultUtils,
  ConsoleLogger,
  NoOpLogger,
  ConfigManager,
  createConfig,
  type IKeyValueStore,
  type CacheItemInput, 
  Result
} from "../src";

describe("InMemoryStore", () => {
  let store: InMemoryStore<number>;

  beforeEach(() => {
    store = new InMemoryStore<number>();
  });

  it("sets, gets and deletes with Result types", async () => {
    const setResult = await store.set("a", 1);
    expect(setResult.ok).toBe(true);

    const getResult = await store.get("a");
    if (getResult.ok) {
      expect(getResult.value).toBe(1);
    }

    const hasResult = await store.has("a");
    if (hasResult.ok) {
      expect(hasResult.value).toBe(true);
    }

    const deleteResult = await store.delete("a");
    if (deleteResult.ok) {
      expect(deleteResult.value).toBe(true);
    }

    const getAfterDelete = await store.get("a");
    if (getAfterDelete.ok) {
      expect(getAfterDelete.value).toBeUndefined();
    }
  });

  it("supports batch operations", async () => {
    const msetResult = await store.mset([
      { key: "key1", value: 1 },
      { key: "key2", value: 2 },
      { key: "key3", value: 3 }
    ]);
    
    if (msetResult.ok) {
      expect(msetResult.value.successful).toEqual(["key1", "key2", "key3"]);
      expect(msetResult.value.failed).toEqual([]);
    }

    const mgetResult = await store.mget(["key1", "key2", "key3", "nonexistent"]);
    if (mgetResult.ok) {
      expect(mgetResult.value.get("key1")).toBe(1);
      expect(mgetResult.value.get("key2")).toBe(2);
      expect(mgetResult.value.get("key3")).toBe(3);
      expect(mgetResult.value.has("nonexistent")).toBe(false);
    }
  });

  it("provides basic statistics", async () => {
    await store.set("test", 42);
    
    const statsResult = await store.getStats();
    if (statsResult.ok) {
      expect(statsResult.value.keyCount).toBe(1);
    }
  });

  it("handles overwrite protection", async () => {
    await store.set("test", 1);
    
    const overwriteResult = await store.set("test", 2, { overwrite: false });
    expect(overwriteResult.ok).toBe(false);
    
    const getResult = await store.get("test");
    if (getResult.ok) {
      expect(getResult.value).toBe(1);
    }
  });
});

describe("EnhancedMemoryStore", () => {
  let store: EnhancedMemoryStore<string>;

  beforeEach(() => {
    store = new EnhancedMemoryStore<string>();
  });

  afterEach(() => {
    store.destroy();
  });

  it("supports TTL functionality", async () => {
    const ttlMs = 100;
    await store.set("ttl-test", "value", { ttlMs });
    
    let getResult = await store.get("ttl-test");
    if (getResult.ok) {
      expect(getResult.value).toBe("value");
    }
    
    // Check TTL
    const ttlResult = await store.getTtl("ttl-test");
    if (ttlResult.ok) {
      expect(ttlResult.value).toBeGreaterThan(0);
      expect(ttlResult.value!).toBeLessThanOrEqual(ttlMs);
    }
    
    // Wait for expiration
    await new Promise(resolve => setTimeout(resolve, ttlMs + 10));
    
    getResult = await store.get("ttl-test");
    if (getResult.ok) {
      expect(getResult.value).toBeUndefined();
    }
  });

  it("tracks detailed statistics", async () => {
    await store.set("test1", "value1");
    await store.set("test2", "value2");
    await store.get("test1"); // hit
    await store.get("nonexistent"); // miss
    
    const statsResult = await store.getStats();
    if (statsResult.ok) {
      expect(statsResult.value.keyCount).toBe(2);
      expect(statsResult.value.hits).toBe(1);
      expect(statsResult.value.misses).toBe(1);
      expect(statsResult.value.hitRatio).toBe(0.5);
    }
  });

  it("supports LRU eviction", async () => {
    await store.set("a", "1");
    await store.set("b", "2");
    await store.set("c", "3");
    
    // Access 'a' to make it most recently used
    await store.get("a");
    
    const lruResult = await store.getLruKeys(2);
    if (lruResult.ok) {
      // LRU returns least recently used first (from tail)
      expect(lruResult.value).toEqual(["b", "c"]); // Least recently used first
    }
    
    const evictResult = await store.evict(1);
    if (evictResult.ok) {
      expect(evictResult.value).toHaveLength(1);
    }
  });

  it("provides metadata for stored values", async () => {
    const beforeSet = Date.now();
    await store.set("meta-test", "value");
    const afterSet = Date.now();
    
    const metadataResult = await store.getWithMetadata("meta-test");
    if (metadataResult.ok && metadataResult.value) {
      expect(metadataResult.value.value).toBe("value");
      expect(metadataResult.value.metadata.createdAt).toBeGreaterThanOrEqual(beforeSet);
      expect(metadataResult.value.metadata.createdAt).toBeLessThanOrEqual(afterSet);
      expect(metadataResult.value.metadata.accessCount).toBe(1);
      expect(metadataResult.value.metadata.sizeBytes).toBeGreaterThan(0);
    }
  });
});

describe("NamespacedStore", () => {
  let baseStore: InMemoryStore<string>;
  let namespacedStore: NamespacedStore<string>;

  beforeEach(() => {
    baseStore = new InMemoryStore<string>();
    namespacedStore = new NamespacedStore(baseStore, "test-ns");
  });

  it("prefixes keys correctly", async () => {
    await namespacedStore.set("key", "value");
    
    const getResult = await namespacedStore.get("key");
    if (getResult.ok) {
      expect(getResult.value).toBe("value");
    }
    
    // Check that the key is actually prefixed in the base store
    const baseGetResult = await baseStore.get("test-ns:key");
    if (baseGetResult.ok) {
      expect(baseGetResult.value).toBe("value");
    }
    
    // Ensure the unprefixed key doesn't exist in base store
    const unprefixedResult = await baseStore.get("key");
    if (unprefixedResult.ok) {
      expect(unprefixedResult.value).toBeUndefined();
    }
  });

  it("supports batch operations with namespacing", async () => {
    const msetResult = await namespacedStore.mset([
      { key: "a", value: "1" },
      { key: "b", value: "2" }
    ]);
    
    if (msetResult.ok) {
      expect(msetResult.value.successful).toEqual(["a", "b"]);
    }
    
    const mgetResult = await namespacedStore.mget(["a", "b"]);
    if (mgetResult.ok) {
      expect(mgetResult.value.get("a")).toBe("1");
      expect(mgetResult.value.get("b")).toBe("2");
    }
  });

  it("lists keys without namespace prefix", async () => {
    await namespacedStore.set("test1", "value1");
    await namespacedStore.set("test2", "value2");
    
    const keysResult = await namespacedStore.keys();
    if (keysResult.ok) {
      expect(keysResult.value).toEqual(expect.arrayContaining(["test1", "test2"]));
      expect(keysResult.value.every(key => !key.includes("test-ns:"))).toBe(true);
    }
  });
});

describe("cacheItem use-case", () => {
  let store: IKeyValueStore<number>;

  beforeEach(() => {
    store = new InMemoryStore<number>();
  });

  it("caches values correctly (backward compatibility)", async () => {
    let calls = 0;
    const fetcher = async () => { calls++; return 42; };
    
    const r1 = await simpleCacheItem({ store, key: "answer", fetcher });
    if (r1.ok) {
      expect(r1.value).toBe(42);
    }
    
    const r2 = await simpleCacheItem({ store, key: "answer", fetcher });
    if (r2.ok) {
      expect(r2.value).toBe(42);
    }
    
    expect(calls).toBe(1);
  });

  it("provides detailed cache results", async () => {
    let calls = 0;
    const fetcher = async () => { 
      calls++; 
      // Add small delay to ensure measurable operation time
      await new Promise(resolve => setTimeout(resolve, 1));
      return 42; 
    };
    
    // First call - cache miss
    const r1 = await cacheItem({ store, key: "detailed", fetcher });
    if (r1.ok) {
      expect(r1.value.value).toBe(42);
      expect(r1.value.fromCache).toBe(false);
      expect(r1.value.metadata.cacheHit).toBe(false);
      expect(r1.value.metadata.operationTimeMs).toBeGreaterThanOrEqual(0);
    }
    
    // Second call - cache hit
    const r2 = await cacheItem({ store, key: "detailed", fetcher });
    if (r2.ok) {
      expect(r2.value.value).toBe(42);
      expect(r2.value.fromCache).toBe(true);
      expect(r2.value.metadata.cacheHit).toBe(true);
    }
    
    expect(calls).toBe(1);
  });

  it("handles fetcher failures with retries", async () => {
    let attempts = 0;
    const fetcher = async () => {
      attempts++;
      if (attempts < 3) {
        throw new Error("Simulated failure");
      }
      return 42;
    };
    
    const result = await cacheItem({ 
      store, 
      key: "retry-test", 
      fetcher,
      options: { maxRetries: 3, retryDelayMs: 10 }
    });
    
    if (result.ok) {
      expect(result.value.value).toBe(42);
      expect(result.value.metadata.retryAttempted).toBe(true);
      expect(result.value.metadata.retryCount).toBe(2);
    }
    expect(attempts).toBe(3);
  });

  it("returns default value when all retries fail", async () => {
    const fetcher = async () => {
      throw new Error("Always fails");
    };
    
    const result = await cacheItem({ 
      store, 
      key: "fail-test", 
      fetcher,
      options: { 
        maxRetries: 1, 
        retryDelayMs: 10,
        defaultValue: 999
      }
    });
    
    if (result.ok) {
      expect(result.value.value).toBe(999);
      expect(result.value.fromCache).toBe(false);
    }
  });

  it("supports TTL in cache options", async () => {
    const enhancedStore = new EnhancedMemoryStore<number>();
    const fetcher = async () => 42;
    
    const result = await cacheItem({ 
      store: enhancedStore, 
      key: "ttl-cache", 
      fetcher,
      options: { ttlMs: 100 }
    });
    
    expect(result.ok).toBe(true);
    
    const ttlResult = await enhancedStore.getTtl("ttl-cache");
    if (ttlResult.ok) {
      expect(ttlResult.value).toBeGreaterThan(0);
    }
    
    enhancedStore.destroy();
  });
});

describe("Advanced cache operations", () => {
  let store: EnhancedMemoryStore<number>;

  beforeEach(() => {
    store = new EnhancedMemoryStore<number>();
  });

  afterEach(() => {
    store.destroy();
  });

  it("supports cache invalidation", async () => {
    const fetcher = async () => 42;
    
    // Cache the value
    await simpleCacheItem({ store, key: "invalidate-test", fetcher });
    
    // Use invalidation with short timeout
    const result = await cacheWithInvalidation({ 
      store, 
      key: "invalidate-test", 
      fetcher,
      invalidateAfterMs: 50
    });
    
    if (result.ok) {
      expect(result.value).toBe(42);
    }
    
    // Wait for invalidation period
    await new Promise(resolve => setTimeout(resolve, 60));
    
    let fetchCalls = 0;
    const newFetcher = async () => { fetchCalls++; return 99; };
    
    const invalidatedResult = await cacheWithInvalidation({ 
      store, 
      key: "invalidate-test", 
      fetcher: newFetcher,
      invalidateAfterMs: 50
    });
    
    if (invalidatedResult.ok) {
      expect(invalidatedResult.value).toBe(99);
    }
    expect(fetchCalls).toBe(1);
  });

  it("supports multiple cache operations", async () => {
    const inputs: CacheItemInput<number>[] = [
      { store, key: "multi1", fetcher: async () => 1 },
      { store, key: "multi2", fetcher: async () => 2 },
      { store, key: "multi3", fetcher: async () => 3 }
    ];
    
    const result = await cacheMultipleItems(inputs);
    if (result.ok) {
      expect(result.value.size).toBe(3);
      expect(result.value.get("multi1")?.value).toBe(1);
      expect(result.value.get("multi2")?.value).toBe(2);
      expect(result.value.get("multi3")?.value).toBe(3);
    }
  });
});

describe("Result utilities", () => {
  it("maps successful results", () => {
    const result: Result<number, Error> = Ok(5);
    const mapped: Result<number, Error> = ResultUtils.map(result, x => x * 2);
    if (mapped.ok) {
      expect(mapped.value).toBe(10);
    }
  });

  it("doesn't map failed results", () => {
    const result = Err(new Error("test"));
    const mapped = ResultUtils.map(result, (_x: never) => _x);
    expect(mapped.ok).toBe(false);
  });

  it("combines multiple results", () => {
    const results = [Ok(1), Ok(2), Ok(3)];
    const combined = ResultUtils.all(results);
    if (combined.ok) {
      expect(combined.value).toEqual([1, 2, 3]);
    }
    
    const mixedResults = [Ok(1), Err(new Error("fail")), Ok(3)];
    const combinedMixed = ResultUtils.all(mixedResults);
    expect(combinedMixed.ok).toBe(false);
  });

  it("safely wraps functions", () => {
    const safeResult = ResultUtils.safe(() => 42);
    if (safeResult.ok) {
      expect(safeResult.value).toBe(42);
    }
    
    const errorResult = ResultUtils.safe(() => {
      throw new Error("test error");
    });
    expect(errorResult.ok).toBe(false);
  });
});

describe("Configuration management", () => {
  it("provides default configuration", () => {
    const config: ConfigManager = createConfig();
    expect(config.get('defaultTtlMs')).toBe(5 * 60 * 1000);
    expect(config.get('maxCacheSize')).toBe(1000);
    expect(config.get('debug')).toBe(false);
  });

  it("allows configuration updates", () => {
    const config: ConfigManager = createConfig({ debug: true, defaultTtlMs: 10000 });
    expect(config.get('debug')).toBe(true);
    expect(config.get('defaultTtlMs')).toBe(10000);
    
    config.updateConfig({ maxCacheSize: 2000 });
    expect(config.get('maxCacheSize')).toBe(2000);
    expect(config.get('debug')).toBe(true); // Should persist
  });

  it("provides appropriate loggers", () => {
    const consoleLogger: ConsoleLogger = new ConsoleLogger(true);
    const noOpLogger: NoOpLogger = new NoOpLogger();
    
    // These shouldn't throw
    consoleLogger.debug("test");
    consoleLogger.info("test");
    consoleLogger.warn("test");
    consoleLogger.error("test");
    
    noOpLogger.debug("test");
    noOpLogger.info("test");
    noOpLogger.warn("test");
    noOpLogger.error("test");
  });
});