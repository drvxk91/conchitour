import { describe, it, expect } from 'vitest';
import { isValidSlug, toSlug, uniqueSlug } from './slug';

describe('isValidSlug', () => {
  it('rejects a single character (too short)', () => {
    expect(isValidSlug('a')).toBe(false);
  });

  it('accepts hello_world', () => {
    expect(isValidSlug('hello_world')).toBe(true);
  });

  it('rejects uppercase', () => {
    expect(isValidSlug('Hello')).toBe(false);
  });

  it('accepts hyphen-separated slug', () => {
    expect(isValidSlug('a-b-c')).toBe(true);
  });

  it('rejects empty string', () => {
    expect(isValidSlug('')).toBe(false);
  });

  it('rejects slug starting with underscore', () => {
    expect(isValidSlug('_bad')).toBe(false);
  });

  it('rejects slug starting with hyphen', () => {
    expect(isValidSlug('-bad')).toBe(false);
  });

  it('accepts exactly 2 characters', () => {
    expect(isValidSlug('ab')).toBe(true);
  });

  it('rejects 51-character slug', () => {
    expect(isValidSlug('a'.repeat(51))).toBe(false);
  });

  it('accepts 50-character slug', () => {
    expect(isValidSlug('a'.repeat(50))).toBe(true);
  });
});

describe('toSlug', () => {
  it('lowercases and replaces spaces', () => {
    expect(toSlug('Hello World!')).toBe('hello_world');
  });

  it('strips accents from Café', () => {
    expect(toSlug('Café')).toBe('cafe');
  });

  it('strips accents from Müller', () => {
    expect(toSlug('Müller')).toBe('muller');
  });

  it('preserves hyphens and underscores', () => {
    expect(toSlug('my-cool_scene')).toBe('my-cool_scene');
  });

  it('trims leading and trailing underscores', () => {
    expect(toSlug('!hello!')).toBe('hello');
  });

  it('truncates to 50 characters', () => {
    const result = toSlug('a'.repeat(100));
    expect(result.length).toBe(50);
  });

  it('handles all-special characters', () => {
    const result = toSlug('!!!');
    expect(result).toBe('');
  });
});

describe('uniqueSlug', () => {
  it('returns base slug when not taken', () => {
    expect(uniqueSlug('lobby', new Set())).toBe('lobby');
  });

  it('returns _2 suffix when base is taken', () => {
    expect(uniqueSlug('lobby', new Set(['lobby']))).toBe('lobby_2');
  });

  it('increments suffix when both base and _2 are taken', () => {
    expect(uniqueSlug('lobby', new Set(['lobby', 'lobby_2']))).toBe('lobby_3');
  });

  it('skips to _3 when _2 is also taken', () => {
    const taken = new Set(['lobby', 'lobby_2']);
    expect(uniqueSlug('lobby', taken)).toBe('lobby_3');
  });

  it('falls back to scene when toSlug returns empty', () => {
    expect(uniqueSlug('!!!', new Set())).toBe('scene');
  });

  it('handles high suffix numbers', () => {
    const taken = new Set(['lobby', 'lobby_2', 'lobby_3', 'lobby_4']);
    expect(uniqueSlug('lobby', taken)).toBe('lobby_5');
  });
});
