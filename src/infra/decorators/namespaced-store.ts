import type { 
  IKeyValueStore, 
  SetOptions, 
  GetOptions, 
  StoredValue, 
  BatchSetOperation, 
  BatchResult, 
  StoreStats 
} from "../../core/contracts/key-value-store";
import type { Result } from "../../core/result";

/**
 * Decorator that composes another store and adds namespacing (Open/Closed principle).
 * All keys are automatically prefixed with the namespace.
 */
export class NamespacedStore<V = unknown> implements IKeyValueStore<V> {
  constructor(private readonly inner: IKeyValueStore<V>, private readonly ns: string) {}

  private k(key: string): string { 
    return `${this.ns}:${key}`; 
  }

  private unk(namespacedKey: string): string {
    const prefix = `${this.ns}:`;
    return namespacedKey.startsWith(prefix) ? namespacedKey.slice(prefix.length) : namespacedKey;
  }

  async get(key: string, options?: GetOptions): Promise<Result<V | undefined, any>> {
    return this.inner.get(this.k(key), options);
  }

  async set(key: string, value: V, options?: SetOptions): Promise<Result<void, any>> {
    return this.inner.set(this.k(key), value, options);
  }

  async has(key: string): Promise<Result<boolean, any>> {
    return this.inner.has(this.k(key));
  }

  async delete(key: string): Promise<Result<boolean, any>> {
    return this.inner.delete(this.k(key));
  }

  async clear(): Promise<Result<void, any>> {
    return this.inner.clear();
  }

  async mget(keys: string[], options?: GetOptions): Promise<Result<Map<string, V>, any>> {
    const namespacedKeys = keys.map(k => this.k(k));
    const result = await this.inner.mget(namespacedKeys, options);
    
    if (!result.ok) {
      return result;
    }

    // Convert namespaced keys back to original keys
    const unNamespacedMap = new Map<string, V>();
    for (const [namespacedKey, value] of result.value.entries()) {
      const originalKey = this.unk(namespacedKey);
      unNamespacedMap.set(originalKey, value);
    }

    return { ok: true, value: unNamespacedMap };
  }

  async mset(operations: BatchSetOperation<V>[]): Promise<Result<BatchResult<string>, any>> {
    const namespacedOps = operations.map(op => ({
      ...op,
      key: this.k(op.key)
    }));

    const result = await this.inner.mset(namespacedOps);
    
    if (!result.ok) {
      return result;
    }

    // Convert namespaced keys back to original keys
    const unNamespacedResult: BatchResult<string> = {
      successful: result.value.successful.map(k => this.unk(k)),
      failed: result.value.failed.map(f => ({
        ...f,
        key: this.unk(f.key)
      }))
    };

    return { ok: true, value: unNamespacedResult };
  }

  async mdel(keys: string[]): Promise<Result<BatchResult<string>, any>> {
    const namespacedKeys = keys.map(k => this.k(k));
    const result = await this.inner.mdel(namespacedKeys);
    
    if (!result.ok) {
      return result;
    }

    // Convert namespaced keys back to original keys
    const unNamespacedResult: BatchResult<string> = {
      successful: result.value.successful.map(k => this.unk(k)),
      failed: result.value.failed.map(f => ({
        ...f,
        key: this.unk(f.key)
      }))
    };

    return { ok: true, value: unNamespacedResult };
  }

  async getWithMetadata(key: string): Promise<Result<StoredValue<V> | undefined, any>> {
    return this.inner.getWithMetadata(this.k(key));
  }

  async updateTtl(key: string, ttlMs: number): Promise<Result<boolean, any>> {
    return this.inner.updateTtl(this.k(key), ttlMs);
  }

  async getTtl(key: string): Promise<Result<number | undefined, any>> {
    return this.inner.getTtl(this.k(key));
  }

  async keys(pattern?: string): Promise<Result<string[], any>> {
    // Adjust pattern to include namespace
    const namespacedPattern = pattern ? `${this.ns}:${pattern}` : `${this.ns}:*`;
    const result = await this.inner.keys(namespacedPattern);
    
    if (!result.ok) {
      return result;
    }

    // Remove namespace prefix from returned keys
    const unNamespacedKeys = result.value.map(k => this.unk(k));
    return { ok: true, value: unNamespacedKeys };
  }

  async sizeof(key: string): Promise<Result<number | undefined, any>> {
    return this.inner.sizeof(this.k(key));
  }

  async getStats(): Promise<Result<StoreStats, any>> {
    // Note: Stats are for the entire inner store, not just this namespace
    return this.inner.getStats();
  }

  async cleanup(): Promise<Result<number, any>> {
    return this.inner.cleanup();
  }

  async ping(): Promise<Result<boolean, any>> {
    return this.inner.ping();
  }
}