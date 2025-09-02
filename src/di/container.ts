import 'reflect-metadata';
import { Container, interfaces } from 'inversify';
import { TYPES } from './types';

// Core imports
import type { Logger, MemoryStoreConfig, RedisStoreConfig } from '../core/config';
import { ConfigManager, ConsoleLogger, NoOpLogger } from '../core/config';
import type { IKeyValueStore } from '../core/contracts/key-value-store';

// Store implementations
import { InMemoryStore } from '../infra/memory/in-memory-store';
import { EnhancedMemoryStore } from '../infra/memory/enhanced-memory-store';
import { RedisStore } from '../infra/redis/redis-store';
// Store decorators and multi-tier stores will be imported when needed
// import { NamespacedStore } from '../infra/decorators/namespaced-store';
// import { MultiTierStore } from '../infra/hybrid/multi-tier-store';

// Services will be imported when they exist

/**
 * Main dependency injection container for eGenome-Libs
 */
export class DIContainer {
  private static instance: Container | null = null;

  /**
   * Gets the singleton DI container instance
   */
  public static getInstance(): Container {
    if (!DIContainer.instance) {
      DIContainer.instance = DIContainer.createContainer();
    }
    return DIContainer.instance;
  }

  /**
   * Creates and configures the DI container
   */
  private static createContainer(): Container {
    const container: Container = new Container();

    // Bind configuration
    container.bind<ConfigManager>(TYPES.ConfigManager)
      .to(ConfigManager)
      .inSingletonScope();

    // Bind logger (conditional based on config)
    container.bind<Logger>(TYPES.Logger)
      .toDynamicValue((context: interfaces.Context) => {
        const config: ConfigManager = context.container.get<ConfigManager>(TYPES.ConfigManager);
        const isDebug: boolean = config.get('debug') || false;
        return isDebug ? new ConsoleLogger(true) : new NoOpLogger();
      })
      .inSingletonScope();

    // Bind store implementations
    container.bind<IKeyValueStore<any>>(TYPES.InMemoryStore)
      .to(InMemoryStore)
      .inTransientScope();

    container.bind<IKeyValueStore<any>>(TYPES.EnhancedMemoryStore)
      .toDynamicValue((context: interfaces.Context) => {
        const config: ConfigManager = context.container.get<ConfigManager>(TYPES.ConfigManager);
        const memoryConfig: MemoryStoreConfig | undefined = config.get('stores')?.memory;
        return new EnhancedMemoryStore(memoryConfig);
      })
      .inTransientScope();

    container.bind<IKeyValueStore<any>>(TYPES.RedisStore)
      .toDynamicValue((context: interfaces.Context) => {
        const config: ConfigManager = context.container.get<ConfigManager>(TYPES.ConfigManager);
        const redisConfig: RedisStoreConfig | undefined = config.get('stores')?.redis;
        return new RedisStore(redisConfig);
      })
      .inTransientScope();

    // Services bindings will be added when services are ready
    // container.bind<StoreFactory>(TYPES.StoreFactory)
    //   .to(StoreFactory)
    //   .inSingletonScope();

    // container.bind<CacheItemService>(TYPES.CacheItemService)
    //   .to(CacheItemService)
    //   .inTransientScope();

    return container;
  }

  /**
   * Resets the container (useful for testing)
   */
  public static reset(): void {
    DIContainer.instance = null;
  }

  /**
   * Creates a new container instance (for testing/isolation)
   */
  public static createNew(): Container {
    return DIContainer.createContainer();
  }
}

/**
 * Default container instance for convenience
 */
export const container: Container = DIContainer.getInstance();
