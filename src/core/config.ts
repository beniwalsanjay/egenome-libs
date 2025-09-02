import { injectable } from 'inversify';
import 'reflect-metadata';

/**
 * Configuration interface for the eGenome library
 */
export interface EGenomeConfig {
  /** Default TTL for cache items in milliseconds */
  defaultTtlMs?: number;
  /** Maximum number of items in cache (for LRU implementations) */
  maxCacheSize?: number;
  /** Enable debug logging */
  debug?: boolean;
  /** Logger instance for custom logging */
  logger?: Logger;
  /** Serialization options */
  serialization?: {
    /** Enable JSON serialization for complex objects */
    enableJson?: boolean;
    /** Custom serializer function */
    serializer?: <T>(value: T) => string;
    /** Custom deserializer function */
    deserializer?: <T>(value: string) => T;
  };
  /** Cache eviction policy */
  evictionPolicy?: 'LRU' | 'LFU' | 'FIFO' | 'TTL_ONLY';
  /** Store-specific configurations */
  stores?: {
    /** In-memory store configuration */
    memory?: MemoryStoreConfig;
    /** Redis store configuration (if implemented) */
    redis?: RedisStoreConfig;
  };
}

/**
 * Configuration for in-memory store
 */
export interface MemoryStoreConfig {
  /** Maximum memory usage in bytes */
  maxMemoryBytes?: number;
  /** Check interval for TTL cleanup in milliseconds */
  cleanupIntervalMs?: number;
  /** Enable automatic cleanup of expired items */
  autoCleanup?: boolean;
}

/**
 * Configuration for Redis store (future implementation)
 */
export interface RedisStoreConfig {
  /** Redis connection URL */
  url?: string;
  /** Redis host */
  host?: string;
  /** Redis port */
  port?: number;
  /** Redis password */
  password?: string;
  /** Redis database number */
  db?: number;
  /** Connection timeout in milliseconds */
  connectTimeoutMs?: number;
  /** Command timeout in milliseconds */
  commandTimeoutMs?: number;
}

/**
 * Logger interface for custom logging implementations
 */
export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG: Required<Omit<EGenomeConfig, 'logger' | 'stores'>> & {
  stores: {
    memory: Required<MemoryStoreConfig>;
    redis: Required<RedisStoreConfig>;
  };
} = {
  defaultTtlMs: 5 * 60 * 1000, // 5 minutes
  maxCacheSize: 1000,
  debug: false,
  serialization: {
    enableJson: true,
    serializer: JSON.stringify,
    deserializer: JSON.parse
  },
  evictionPolicy: 'LRU',
  stores: {
    memory: {
      maxMemoryBytes: 50 * 1024 * 1024, // 50MB
      cleanupIntervalMs: 60 * 1000, // 1 minute
      autoCleanup: true
    },
    redis: {
      url: 'redis://localhost:6379',
      host: 'localhost',
      port: 6379,
      password: '',
      db: 0,
      connectTimeoutMs: 5000,
      commandTimeoutMs: 3000
    }
  }
};

/**
 * Simple console logger implementation
 */
export class ConsoleLogger implements Logger {
  constructor(private readonly enableDebug: boolean = false) {}

  debug(message: string, meta?: Record<string, unknown>): void {
    if (this.enableDebug) {
      console.debug(`[DEBUG] ${message}`, meta ? JSON.stringify(meta) : '');
    }
  }

  info(message: string, meta?: Record<string, unknown>): void {
    console.info(`[INFO] ${message}`, meta ? JSON.stringify(meta) : '');
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    console.warn(`[WARN] ${message}`, meta ? JSON.stringify(meta) : '');
  }

  error(message: string, meta?: Record<string, unknown>): void {
    console.error(`[ERROR] ${message}`, meta ? JSON.stringify(meta) : '');
  }
}

/**
 * No-op logger that discards all log messages
 */
export class NoOpLogger implements Logger {
  debug(_message: string, _meta?: Record<string, unknown>): void {}
  info(_message: string, _meta?: Record<string, unknown>): void {}
  warn(_message: string, _meta?: Record<string, unknown>): void {}
  error(_message: string, _meta?: Record<string, unknown>): void {}
}

/**
 * Configuration manager for the eGenome library
 */
@injectable()
export class ConfigManager {
  private static instance: ConfigManager;
  private config: EGenomeConfig;

  constructor(initialConfig: EGenomeConfig = {}) {
    this.config = this.mergeWithDefaults(initialConfig);
  }

  /**
   * Gets the singleton instance of ConfigManager
   */
  static getInstance(initialConfig?: EGenomeConfig): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager(initialConfig);
    }
    return ConfigManager.instance;
  }

  /**
   * Gets the current configuration
   */
  getConfig(): EGenomeConfig {
    return { ...this.config };
  }

  /**
   * Updates the configuration
   */
  updateConfig(updates: Partial<EGenomeConfig>): void {
    this.config = this.mergeWithDefaults({ ...this.config, ...updates });
  }

  /**
   * Gets a specific configuration value with fallback to default
   */
  get<K extends keyof EGenomeConfig>(key: K): EGenomeConfig[K] {
    return this.config[key];
  }

  /**
   * Sets a specific configuration value
   */
  set<K extends keyof EGenomeConfig>(key: K, value: EGenomeConfig[K]): void {
    this.config[key] = value;
  }

  /**
   * Resets configuration to defaults
   */
  reset(): void {
    this.config = this.mergeWithDefaults({});
  }

  /**
   * Merges user config with defaults
   */
  private mergeWithDefaults(userConfig: EGenomeConfig): EGenomeConfig {
    const logger: Logger = userConfig.logger || (userConfig.debug ? new ConsoleLogger(true) : new NoOpLogger());
    
    return {
      ...DEFAULT_CONFIG,
      ...userConfig,
      logger,
      serialization: {
        ...DEFAULT_CONFIG.serialization,
        ...userConfig.serialization
      },
      stores: {
        memory: {
          ...DEFAULT_CONFIG.stores.memory,
          ...userConfig.stores?.memory
        },
        redis: {
          ...DEFAULT_CONFIG.stores.redis,
          ...userConfig.stores?.redis
        }
      }
    };
  }
}

/**
 * Creates a new configuration instance (not singleton)
 */
export function createConfig(config: EGenomeConfig = {}): ConfigManager {
  // Create a new instance by temporarily clearing the singleton
  const originalInstance: ConfigManager = (ConfigManager as any).instance;
  (ConfigManager as any).instance = undefined;
  const newInstance: ConfigManager = ConfigManager.getInstance(config);
  (ConfigManager as any).instance = originalInstance;
  return newInstance;
}

/**
 * Gets the global configuration instance
 */
export function getGlobalConfig(): ConfigManager {
  return ConfigManager.getInstance();
}
