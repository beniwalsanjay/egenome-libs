import type { EGenomeError } from './errors';

/**
 * Represents the result of an operation that can either succeed with a value T or fail with an error E
 */
export type Result<T, E = EGenomeError> = Success<T> | Failure<E>;

/**
 * Represents a successful result containing a value
 */
export interface Success<T> {
  readonly ok: true;
  readonly value: T;
}

/**
 * Represents a failed result containing an error
 */
export interface Failure<E> {
  readonly ok: false;
  readonly error: E;
}

/**
 * Creates a successful Result
 */
export const Ok = <T>(value: T): Success<T> => ({ ok: true, value });

/**
 * Creates a failed Result
 */
export const Err = <E>(error: E): Failure<E> => ({ ok: false, error });

/**
 * Result utility functions for functional programming patterns
 */
export class ResultUtils {
  /**
   * Maps a successful Result to a new value using the provided function
   */
  static map<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
    return result.ok ? Ok(fn(result.value)) : result;
  }

  /**
   * Flat maps a successful Result to a new Result using the provided function
   */
  static flatMap<T, U, E>(result: Result<T, E>, fn: (value: T) => Result<U, E>): Result<U, E> {
    return result.ok ? fn(result.value) : result;
  }

  /**
   * Maps an error Result to a new error using the provided function
   */
  static mapError<T, E, F>(result: Result<T, E>, fn: (error: E) => F): Result<T, F> {
    return result.ok ? result : Err(fn(result.error));
  }

  /**
   * Returns the value if successful, or the provided default value if failed
   */
  static unwrapOr<T, E>(result: Result<T, E>, defaultValue: T): T {
    return result.ok ? result.value : defaultValue;
  }

  /**
   * Returns the value if successful, or calls the provided function with the error
   */
  static unwrapOrElse<T, E>(result: Result<T, E>, fn: (error: E) => T): T {
    return result.ok ? result.value : fn(result.error);
  }

  /**
   * Returns the value if successful, or throws the error
   */
  static unwrap<T, E extends Error>(result: Result<T, E>): T {
    if (result.ok) {
      return result.value;
    }
    throw result.error;
  }

  /**
   * Checks if the Result is successful
   */
  static isOk<T, E>(result: Result<T, E>): result is Success<T> {
    return result.ok;
  }

  /**
   * Checks if the Result is failed
   */
  static isErr<T, E>(result: Result<T, E>): result is Failure<E> {
    return !result.ok;
  }

  /**
   * Combines multiple Results into a single Result containing an array of values
   * Returns the first error if any Result fails
   */
  static all<T, E>(results: Result<T, E>[]): Result<T[], E> {
    const values: T[] = [];
    for (const result of results) {
      if (!result.ok) {
        return result;
      }
      values.push(result.value);
    }
    return Ok(values);
  }

  /**
   * Wraps a potentially throwing function in a Result
   */
  static safe<T, E = Error>(fn: () => T): Result<T, E> {
    try {
      return Ok(fn());
    } catch (error) {
      return Err(error as E);
    }
  }

  /**
   * Wraps a potentially throwing async function in a Result
   */
  static async safeAsync<T, E = Error>(fn: () => Promise<T>): Promise<Result<T, E>> {
    try {
      const value = await fn();
      return Ok(value);
    } catch (error) {
      return Err(error as E);
    }
  }
}

/**
 * Convenience re-exports for common patterns
 */
export const { map, flatMap, mapError, unwrapOr, unwrapOrElse, unwrap, isOk, isErr, all, safe, safeAsync } = ResultUtils;