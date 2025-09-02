/**
 * Base error class for all eGenome library errors
 */
export abstract class EGenomeError extends Error {
  abstract readonly code: string;
  abstract readonly category: 'CACHE' | 'STORE' | 'VALIDATION' | 'NETWORK' | 'UNKNOWN';

  constructor(message: string, public readonly context?: Record<string, unknown>) {
    super(message);
    this.name = this.constructor.name;
    
    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Converts error to a serializable object for logging/debugging
   */
  toObject(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      category: this.category,
      context: this.context,
      stack: this.stack
    };
  }
}

/**
 * Errors related to cache operations
 */
export class CacheError extends EGenomeError {
  readonly category = 'CACHE' as const;
  
  constructor(message: string, public readonly code: CacheErrorCode, context?: Record<string, unknown>) {
    super(message, context);
  }
}

/**
 * Errors related to store operations
 */
export class StoreError extends EGenomeError {
  readonly category = 'STORE' as const;
  
  constructor(message: string, public readonly code: StoreErrorCode, context?: Record<string, unknown>) {
    super(message, context);
  }
}

/**
 * Errors related to validation
 */
export class ValidationError extends EGenomeError {
  readonly category = 'VALIDATION' as const;
  
  constructor(message: string, public readonly code: ValidationErrorCode, context?: Record<string, unknown>) {
    super(message, context);
  }
}

/**
 * Error codes for cache operations
 */
export enum CacheErrorCode {
  FETCH_FAILED = 'CACHE_FETCH_FAILED',
  STORE_FAILED = 'CACHE_STORE_FAILED',
  INVALID_TTL = 'CACHE_INVALID_TTL',
  EXPIRED = 'CACHE_EXPIRED',
  EVICTED = 'CACHE_EVICTED'
}

/**
 * Error codes for store operations
 */
export enum StoreErrorCode {
  CONNECTION_FAILED = 'STORE_CONNECTION_FAILED',
  OPERATION_FAILED = 'STORE_OPERATION_FAILED',
  SERIALIZATION_FAILED = 'STORE_SERIALIZATION_FAILED',
  DESERIALIZATION_FAILED = 'STORE_DESERIALIZATION_FAILED',
  KEY_NOT_FOUND = 'STORE_KEY_NOT_FOUND',
  INVALID_KEY = 'STORE_INVALID_KEY'
}

/**
 * Error codes for validation
 */
export enum ValidationErrorCode {
  INVALID_INPUT = 'VALIDATION_INVALID_INPUT',
  MISSING_REQUIRED_FIELD = 'VALIDATION_MISSING_REQUIRED_FIELD',
  INVALID_TYPE = 'VALIDATION_INVALID_TYPE',
  OUT_OF_RANGE = 'VALIDATION_OUT_OF_RANGE'
}

/**
 * Creates a CacheError
 */
export function createCacheError(message: string, code: CacheErrorCode, context?: Record<string, unknown>): CacheError {
  return new CacheError(message, code, context);
}

/**
 * Creates a StoreError
 */
export function createStoreError(message: string, code: StoreErrorCode, context?: Record<string, unknown>): StoreError {
  return new StoreError(message, code, context);
}

/**
 * Creates a ValidationError
 */
export function createValidationError(message: string, code: ValidationErrorCode, context?: Record<string, unknown>): ValidationError {
  return new ValidationError(message, code, context);
}

/**
 * Type guard to check if an error is an EGenomeError
 */
export function isEGenomeError(error: unknown): error is EGenomeError {
  return error instanceof EGenomeError;
}

/**
 * Type guard to check if an error is a CacheError
 */
export function isCacheError(error: unknown): error is CacheError {
  return error instanceof CacheError;
}

/**
 * Type guard to check if an error is a StoreError
 */
export function isStoreError(error: unknown): error is StoreError {
  return error instanceof StoreError;
}

/**
 * Type guard to check if an error is a ValidationError
 */
export function isValidationError(error: unknown): error is ValidationError {
  return error instanceof ValidationError;
}
