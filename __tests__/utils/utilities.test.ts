/**
 * Comprehensive Tests: Utility Functions
 *
 * Tests for common utility functions and helpers
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Utility Functions', () => {
  describe('Error Handling Utilities', () => {
    it('should extract error message from Error object', () => {
      const error = new Error('Something went wrong');
      const getMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

      expect(getMessage(error)).toBe('Something went wrong');
    });

    it('should extract error message from string', () => {
      const errorMessage = 'Plain error message';
      const getMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

      expect(getMessage(errorMessage)).toBe('Plain error message');
    });

    it('should handle error with cause', () => {
      const cause = new Error('Root cause');
      const error = new Error('Wrapped error', { cause });

      expect(error.cause).toBe(cause);
      expect((error.cause as Error).message).toBe('Root cause');
    });

    it('should create custom error with error code', () => {
      class CustomError extends Error {
        constructor(
          message: string,
          public code: string,
          public status?: number
        ) {
          super(message);
          this.name = 'CustomError';
        }
      }

      const error = new CustomError('Not found', 'NOT_FOUND', 404);

      expect(error.code).toBe('NOT_FOUND');
      expect(error.status).toBe(404);
      expect(error.message).toBe('Not found');
    });

    it('should sanitize error messages for client', () => {
      const sanitizeError = (error: Error, isProduction: boolean) => {
        if (!isProduction) {
          return error.message;
        }

        // Hide internal details in production
        if (error.message.includes('stack trace') || error.message.includes('at ')) {
          return 'An internal error occurred';
        }

        return error.message;
      };

      const devError = new Error('Database failed at line 42\nStack trace...');
      expect(sanitizeError(devError, false)).toContain('Database failed');
      expect(sanitizeError(devError, true)).toBe('An internal error occurred');
    });

    it('should retry async function with exponential backoff', async () => {
      const retryWithBackoff = async <T>(
        fn: () => Promise<T>,
        maxAttempts: number,
        baseDelay: number
      ): Promise<T> => {
        let lastError: Error;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          try {
            return await fn();
          } catch (error) {
            lastError = error as Error;
            if (attempt < maxAttempts) {
              const delay = baseDelay * Math.pow(2, attempt - 1);
              await new Promise(resolve => setTimeout(resolve, delay));
            }
          }
        }

        throw lastError!;
      };

      let attempts = 0;
      const flakyFunction = async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('Temporary failure');
        }
        return 'success';
      };

      const result = await retryWithBackoff(flakyFunction, 5, 10);
      expect(result).toBe('success');
      expect(attempts).toBe(3);
    });

    it('should not retry on non-retryable errors', async () => {
      const retryWithBackoff = async <T>(
        fn: () => Promise<T>,
        isRetryable: (error: Error) => boolean,
        maxAttempts: number
      ): Promise<T> => {
        let lastError: Error;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          try {
            return await fn();
          } catch (error) {
            lastError = error as Error;
            if (!isRetryable(lastError) || attempt === maxAttempts) {
              break;
            }
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }

        throw lastError!;
      };

      const nonRetryableError = new Error('Permanent failure');
      const failingFunction = async () => {
        throw nonRetryableError;
      };

      await expect(retryWithBackoff(failingFunction, () => false, 5)).rejects.toThrow(
        'Permanent failure'
      );
    });
  });

  describe('String Utilities', () => {
    it('should truncate string to max length', () => {
      const truncate = (str: string, maxLength: number, suffix = '...') => {
        if (str.length <= maxLength) return str;
        return str.slice(0, maxLength - suffix.length) + suffix;
      };

      expect(truncate('Short', 10)).toBe('Short');
      expect(truncate('This is a long string', 10)).toBe('This is...');
      expect(truncate('Exact length', 12)).toBe('Exact length');
    });

    it('should capitalize first letter', () => {
      const capitalize = (str: string) => {
        if (!str) return str;
        return str.charAt(0).toUpperCase() + str.slice(1);
      };

      expect(capitalize('hello')).toBe('Hello');
      expect(capitalize('Hello')).toBe('Hello');
      expect(capitalize('')).toBe('');
    });

    it('should convert to title case', () => {
      const toTitleCase = (str: string) => {
        return str.replace(/\w\S*/g, txt => txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase());
      };

      expect(toTitleCase('hello world')).toBe('Hello World');
      expect(toTitleCase('JAVASCRIPT IS GREAT')).toBe('Javascript Is Great');
    });

    it('should convert camelCase to snake_case', () => {
      const camelToSnake = (str: string) => {
        return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
      };

      expect(camelToSnake('camelCase')).toBe('camel_case');
      expect(camelToSnake('myVariableName')).toBe('my_variable_name');
    });

    it('should convert snake_case to camelCase', () => {
      const snakeToCamel = (str: string) => {
        return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
      };

      expect(snakeToCamel('snake_case')).toBe('snakeCase');
      expect(snakeToCamel('my_variable_name')).toBe('myVariableName');
    });

    it('should escape HTML special characters', () => {
      const escapeHtml = (str: string) => {
        const map: Record<string, string> = {
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#039;',
        };
        return str.replace(/[&<>"']/g, m => map[m]);
      };

      expect(escapeHtml('<script>alert("XSS")</script>')).toBe(
        '&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;'
      );
    });

    it('should generate slug from string', () => {
      const generateSlug = (str: string) => {
        return str
          .toLowerCase()
          .trim()
          .replace(/[^\w\s-]/g, '')
          .replace(/[\s_-]+/g, '-')
          .replace(/^-+|-+$/g, '');
      };

      expect(generateSlug('Hello World!')).toBe('hello-world');
      expect(generateSlug('Special  Characters & Symbols')).toBe('special-characters-symbols');
    });

    it('should check if string is valid JSON', () => {
      const isValidJson = (str: string) => {
        try {
          JSON.parse(str);
          return true;
        } catch {
          return false;
        }
      };

      expect(isValidJson('{"key": "value"}')).toBe(true);
      expect(isValidJson('[1, 2, 3]')).toBe(true);
      expect(isValidJson('invalid')).toBe(false);
      expect(isValidJson('{invalid}')).toBe(false);
    });
  });

  describe('Number Utilities', () => {
    it('should clamp number between min and max', () => {
      const clamp = (num: number, min: number, max: number) => {
        return Math.min(Math.max(num, min), max);
      };

      expect(clamp(5, 0, 10)).toBe(5);
      expect(clamp(-5, 0, 10)).toBe(0);
      expect(clamp(15, 0, 10)).toBe(10);
    });

    it('should format number with commas', () => {
      const formatNumber = (num: number) => {
        return num.toLocaleString();
      };

      expect(formatNumber(1000)).toBe('1,000');
      expect(formatNumber(1000000)).toBe('1,000,000');
      expect(formatNumber(123456789)).toBe('123,456,789');
    });

    it('should format bytes to human readable', () => {
      const formatBytes = (bytes: number, decimals = 2) => {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
      };

      expect(formatBytes(0)).toBe('0 Bytes');
      expect(formatBytes(1024)).toBe('1 KB');
      expect(formatBytes(1048576)).toBe('1 MB');
      expect(formatBytes(1073741824)).toBe('1 GB');
    });

    it('should calculate percentage', () => {
      const percentage = (part: number, total: number) => {
        if (total === 0) return 0;
        return (part / total) * 100;
      };

      expect(percentage(25, 100)).toBe(25);
      expect(percentage(50, 200)).toBe(25);
      expect(percentage(0, 100)).toBe(0);
    });

    it('should round to decimal places', () => {
      const roundTo = (num: number, decimals: number) => {
        const factor = Math.pow(10, decimals);
        return Math.round(num * factor) / factor;
      };

      expect(roundTo(3.14159, 2)).toBe(3.14);
      expect(roundTo(3.14159, 4)).toBe(3.1416);
      expect(roundTo(100, 2)).toBe(100);
    });

    it('should generate random number in range', () => {
      const randomInRange = (min: number, max: number) => {
        return Math.floor(Math.random() * (max - min + 1)) + min;
      };

      const result = randomInRange(1, 10);
      expect(result).toBeGreaterThanOrEqual(1);
      expect(result).toBeLessThanOrEqual(10);
    });
  });

  describe('Array Utilities', () => {
    it('should remove duplicates from array', () => {
      const unique = <T>(arr: T[]): T[] => {
        return Array.from(new Set(arr));
      };

      expect(unique([1, 2, 2, 3, 3, 3])).toEqual([1, 2, 3]);
      expect(unique(['a', 'b', 'a', 'c'])).toEqual(['a', 'b', 'c']);
    });

    it('should chunk array into smaller arrays', () => {
      const chunk = <T>(arr: T[], size: number): T[][] => {
        const chunks: T[][] = [];
        for (let i = 0; i < arr.length; i += size) {
          chunks.push(arr.slice(i, i + size));
        }
        return chunks;
      };

      expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
      expect(chunk([1, 2, 3], 5)).toEqual([[1, 2, 3]]);
    });

    it('should flatten nested array', () => {
      const flatten = <T>(arr: T[][]): T[] => {
        return arr.flat();
      };

      expect(flatten([[1, 2], [3, 4], [5]])).toEqual([1, 2, 3, 4, 5]);
      expect(flatten([])).toEqual([]);
    });

    it('should shuffle array randomly', () => {
      const shuffle = <T>(arr: T[]): T[] => {
        const shuffled = [...arr];
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
      };

      const original = [1, 2, 3, 4, 5];
      const shuffled = shuffle(original);

      expect(shuffled).toHaveLength(5);
      expect(shuffled.sort((a, b) => a - b)).toEqual(original);
    });

    it('should group array by key', () => {
      const groupBy = <T>(arr: T[], keyFn: (item: T) => string): Record<string, T[]> => {
        return arr.reduce((acc, item) => {
          const key = keyFn(item);
          if (!acc[key]) {
            acc[key] = [];
          }
          acc[key].push(item);
          return acc;
        }, {} as Record<string, T[]>);
      };

      const items = [
        { type: 'fruit', name: 'apple' },
        { type: 'fruit', name: 'banana' },
        { type: 'vegetable', name: 'carrot' },
      ];

      expect(groupBy(items, item => item.type)).toEqual({
        fruit: [
          { type: 'fruit', name: 'apple' },
          { type: 'fruit', name: 'banana' },
        ],
        vegetable: [{ type: 'vegetable', name: 'carrot' }],
      });
    });

    it('should find intersection of arrays', () => {
      const intersection = <T>(arr1: T[], arr2: T[]): T[] => {
        const set2 = new Set(arr2);
        return arr1.filter(item => set2.has(item));
      };

      expect(intersection([1, 2, 3], [2, 3, 4])).toEqual([2, 3]);
      expect(intersection([1, 2], [3, 4])).toEqual([]);
    });

    it('should find union of arrays', () => {
      const union = <T>(arr1: T[], arr2: T[]): T[] => {
        return Array.from(new Set([...arr1, ...arr2]));
      };

      expect(union([1, 2, 3], [2, 3, 4])).toEqual([1, 2, 3, 4]);
    });
  });

  describe('Object Utilities', () => {
    it('should deep clone object', () => {
      const deepClone = <T>(obj: T): T => {
        return JSON.parse(JSON.stringify(obj));
      };

      const original = { a: 1, b: { c: 2, d: [3, 4] } };
      const cloned = deepClone(original);

      expect(cloned).toEqual(original);
      expect(cloned).not.toBe(original);
      expect(cloned.b).not.toBe(original.b);
    });

    it('should pick specific keys from object', () => {
      const pick = <T extends Record<string, any>, K extends keyof T>(
        obj: T,
        keys: K[]
      ): Pick<T, K> => {
        return keys.reduce((acc, key) => {
          if (key in obj) {
            acc[key] = obj[key];
          }
          return acc;
        }, {} as Pick<T, K>);
      };

      const obj = { a: 1, b: 2, c: 3 };
      expect(pick(obj, ['a', 'c'])).toEqual({ a: 1, c: 3 });
    });

    it('should omit specific keys from object', () => {
      const omit = <T extends Record<string, any>, K extends keyof T>(
        obj: T,
        keys: K[]
      ): Omit<T, K> => {
        const result = { ...obj };
        keys.forEach(key => {
          delete result[key];
        });
        return result as Omit<T, K>;
      };

      const obj = { a: 1, b: 2, c: 3 };
      expect(omit(obj, ['b'])).toEqual({ a: 1, c: 3 });
    });

    it('should check if object is empty', () => {
      const isEmpty = (obj: Record<string, any>) => {
        return Object.keys(obj).length === 0;
      };

      expect(isEmpty({})).toBe(true);
      expect(isEmpty({ a: 1 })).toBe(false);
    });

    it('should deep merge objects', () => {
      const deepMerge = <T extends Record<string, any>>(target: T, source: Partial<T>): T => {
        const result = { ...target };

        for (const key in source) {
          if (source[key] instanceof Object && key in target) {
            result[key] = deepMerge(result[key] as any, source[key] as any);
          } else {
            result[key] = source[key] as T[keyof T];
          }
        }

        return result;
      };

      const target = { a: 1, b: { c: 2, d: 3 } };
      const source = { b: { c: 10, e: 5 }, f: 6 };

      expect(deepMerge(target, source)).toEqual({
        a: 1,
        b: { c: 10, d: 3, e: 5 },
        f: 6,
      });
    });

    it('should invert object keys and values', () => {
      const invert = <K extends string | number | symbol, V extends string | number | symbol>(
        obj: Record<K, V>
      ): Record<V, K> => {
        const result: Record<V, K> = {} as any;
        for (const key in obj) {
          result[obj[key]] = key as K;
        }
        return result;
      };

      expect(invert({ a: 1, b: 2, c: 3 })).toEqual({ 1: 'a', 2: 'b', 3: 'c' });
    });

    it('should map object values', () => {
      const mapValues = <T extends Record<string, any>, U>(
        obj: T,
        fn: (value: T[keyof T], key: keyof T) => U
      ): Record<keyof T, U> => {
        const result = {} as Record<keyof T, U>;
        for (const key in obj) {
          result[key] = fn(obj[key], key);
        }
        return result;
      };

      const obj = { a: 1, b: 2, c: 3 };
      expect(mapValues(obj, v => v * 2)).toEqual({ a: 2, b: 4, c: 6 });
    });
  });

  describe('Date Utilities', () => {
    it('should format date to ISO string', () => {
      const date = new Date('2024-01-15T10:30:00Z');
      expect(date.toISOString()).toBe('2024-01-15T10:30:00.000Z');
    });

    it('should format date to locale string', () => {
      const date = new Date('2024-01-15T10:30:00Z');
      const formatted = date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });

      expect(formatted).toContain('2024');
      expect(formatted).toContain('January');
      expect(formatted).toContain('15');
    });

    it('should calculate date difference in days', () => {
      const diffInDays = (date1: Date, date2: Date) => {
        const msPerDay = 24 * 60 * 60 * 1000;
        return Math.floor((date2.getTime() - date1.getTime()) / msPerDay);
      };

      const date1 = new Date('2024-01-01');
      const date2 = new Date('2024-01-15');

      expect(diffInDays(date1, date2)).toBe(14);
    });

    it('should check if date is in the past', () => {
      const isPast = (date: Date) => date.getTime() < Date.now();

      const pastDate = new Date('2020-01-01');
      const futureDate = new Date('2050-01-01');

      expect(isPast(pastDate)).toBe(true);
      expect(isPast(futureDate)).toBe(false);
    });

    it('should add days to date', () => {
      const addDays = (date: Date, days: number) => {
        const result = new Date(date);
        result.setDate(result.getDate() + days);
        return result;
      };

      const date = new Date('2024-01-01T00:00:00Z');
      const newDate = addDays(date, 10);

      expect(newDate.getUTCDate()).toBe(11);
    });

    it('should check if date is weekend', () => {
      const isWeekend = (date: Date) => {
        const day = date.getUTCDay();
        return day === 0 || day === 6;
      };

      // Use specific dates that are definitely Saturday/Sunday in UTC
      expect(isWeekend(new Date('2024-01-13T00:00:00Z'))).toBe(true); // Saturday
      expect(isWeekend(new Date('2024-01-14T00:00:00Z'))).toBe(true); // Sunday
      expect(isWeekend(new Date('2024-01-15T00:00:00Z'))).toBe(false); // Monday
    });

    it('should get start and end of day', () => {
      const startOfDay = (date: Date) => {
        return new Date(date.getFullYear(), date.getMonth(), date.getDate());
      };

      const endOfDay = (date: Date) => {
        return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
      };

      const date = new Date('2024-01-15T10:30:00Z');

      expect(startOfDay(date).getHours()).toBe(0);
      expect(endOfDay(date).getHours()).toBe(23);
    });
  });

  describe('Promise Utilities', () => {
    it('should delay execution', async () => {
      const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

      const start = Date.now();
      await delay(100);
      const end = Date.now();

      expect(end - start).toBeGreaterThanOrEqual(90); // Allow some tolerance
    });

    it('should retry failed promise', async () => {
      const retry = async <T>(fn: () => Promise<T>, attempts: number): Promise<T> => {
        let lastError: Error;

        for (let i = 0; i < attempts; i++) {
          try {
            return await fn();
          } catch (error) {
            lastError = error as Error;
          }
        }

        throw lastError!;
      };

      let attempts = 0;
      const flakyFn = async () => {
        attempts++;
        if (attempts < 3) throw new Error('Failed');
        return 'success';
      };

      const result = await retry(flakyFn, 5);
      expect(result).toBe('success');
      expect(attempts).toBe(3);
    });

    it('should timeout promise', async () => {
      const withTimeout = async <T>(promise: Promise<T>, ms: number): Promise<T> => {
        const timeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
        );
        return Promise.race([promise, timeout]);
      };

      const slowPromise = new Promise(resolve => setTimeout(() => resolve('done'), 200));

      await expect(withTimeout(slowPromise, 100)).rejects.toThrow('Timeout after 100ms');
    });

    it('should run promises in parallel with limit', async () => {
      const parallelLimit = async <T>(promises: Promise<T>[], limit: number): Promise<T[]> => {
        const results: T[] = [];
        let index = 0;

        const worker = async () => {
          while (index < promises.length) {
            const currentIndex = index++;
            results[currentIndex] = await promises[currentIndex];
          }
        };

        const workers = Array(Math.min(limit, promises.length))
          .fill(null)
          .map(() => worker());

        await Promise.all(workers);
        return results;
      };

      const tasks = Array(5)
        .fill(null)
        .map((_, i) => Promise.resolve(i));

      const results = await parallelLimit(tasks, 2);
      expect(results).toEqual([0, 1, 2, 3, 4]);
    });

    it('should handle promise allSettled', async () => {
      const results = await Promise.allSettled([
        Promise.resolve('success'),
        Promise.reject(new Error('failed')),
      ]);

      expect(results[0]).toEqual({ status: 'fulfilled', value: 'success' });
      expect(results[1]).toEqual({ status: 'rejected', reason: expect.any(Error) });
    });
  });

  describe('Validation Utilities', () => {
    it('should validate email format', () => {
      const isValidEmail = (email: string) => {
        const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return regex.test(email);
      };

      expect(isValidEmail('test@example.com')).toBe(true);
      expect(isValidEmail('invalid')).toBe(false);
      expect(isValidEmail('missing@domain')).toBe(false);
    });

    it('should validate URL format', () => {
      const isValidUrl = (url: string) => {
        try {
          new URL(url);
          return true;
        } catch {
          return false;
        }
      };

      expect(isValidUrl('https://example.com')).toBe(true);
      expect(isValidUrl('http://localhost:3000')).toBe(true);
      expect(isValidUrl('not-a-url')).toBe(false);
    });

    it('should validate UUID format', () => {
      const isValidUuid = (uuid: string) => {
        const regex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        return regex.test(uuid);
      };

      expect(isValidUuid('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
      expect(isValidUuid('invalid-uuid')).toBe(false);
    });

    it('should validate phone number format', () => {
      const isValidPhone = (phone: string) => {
        const regex = /^\+?[\d\s-()]{10,}$/;
        return regex.test(phone);
      };

      expect(isValidPhone('+1-555-123-4567')).toBe(true);
      expect(isValidPhone('5551234567')).toBe(true);
      expect(isValidPhone('123')).toBe(false);
    });

    it('should validate required fields', () => {
      const validateRequired = <T extends Record<string, any>>(
        obj: T,
        requiredFields: (keyof T)[]
      ): string[] => {
        const missing: string[] = [];
        requiredFields.forEach(field => {
          if (obj[field] === undefined || obj[field] === null || obj[field] === '') {
            missing.push(String(field));
          }
        });
        return missing;
      };

      const obj = { name: 'John', age: 30 };
      expect(validateRequired(obj, ['name', 'email'])).toEqual(['email']);
      expect(validateRequired(obj, ['name', 'age'])).toEqual([]);
    });
  });
});
