// @ts-nocheck -- converted from JS; sqlite row shapes left untyped.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import * as provider from '../src/main/modules/theword-twm-provider.ts';
import {
  writeTwmDictionaryFixture,
  writeTwmType2CommentaryFixture,
  writeTwmType3CommentaryFixture,
} from './support/module-fixtures.ts';

let tmpDir: string;
let type2File;
let type3File;
let type1File;
let compressedStrongFile;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'graphe-twm-provider-fixtures-'));
  type2File = writeTwmType2CommentaryFixture(tmpDir);
  type3File = writeTwmType3CommentaryFixture(tmpDir);
  type1File = writeTwmDictionaryFixture(tmpDir);
  compressedStrongFile = writeTwmDictionaryFixture(tmpDir, 'fixture-compressed.dct.twm', {
    compressed: true,
  });
});

afterAll(() => {
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('TWM type=2 (verse-indexed commentary)', () => {
  let handle;

  beforeAll(() => {
    handle = provider.load(type2File);
  });

  afterAll(() => {
    if (handle) provider.close(handle);
  });

  it('loads with topicBased=false', () => {
    expect(handle).toBeTruthy();
    expect(handle.format).toBe('theword-twm');
    expect(handle.topicBased).toBe(false);
    expect(handle.db).toBeDefined();
    expect(handle.config).toBeDefined();
  });

  it('getModuleInfo returns commentary type', () => {
    const info = provider.getModuleInfo(handle);
    expect(info.type).toBe('commentary');
    expect(info.description).toBeTruthy();
  });

  it('getCommentaryBooks returns book numbers', () => {
    const books = provider.getCommentaryBooks(handle);
    expect(books).toBeInstanceOf(Array);
    expect(books.length).toBeGreaterThan(0);
    for (const bn of books) {
      expect(typeof bn).toBe('number');
    }
  });

  it('getCommentary returns entries with correct shape', async () => {
    const books = provider.getCommentaryBooks(handle);
    if (books.length === 0) return;
    const entries = await provider.getCommentary(handle, books[0], 1);
    expect(entries).toBeInstanceOf(Array);
    if (entries.length > 0) {
      const entry = entries[0];
      expect(entry).toHaveProperty('verseFrom');
      expect(entry).toHaveProperty('verseTo');
      expect(entry).toHaveProperty('chapterTo');
      expect(entry).toHaveProperty('text');
      expect(typeof entry.verseFrom).toBe('number');
      expect(typeof entry.text).toBe('string');
      expect(entry.text.length).toBeGreaterThan(0);
    }
  });
});

describe('TWM type=3 (topic-based commentary)', () => {
  let handle;

  beforeAll(() => {
    handle = provider.load(type3File);
  });

  afterAll(() => {
    if (handle) provider.close(handle);
  });

  it('loads with topicBased=true and topicBookMap', () => {
    expect(handle).toBeTruthy();
    expect(handle.format).toBe('theword-twm');
    expect(handle.topicBased).toBe(true);
    expect(handle.topicBookMap).toBeInstanceOf(Map);
    expect(handle.topicBookMap.size).toBeGreaterThan(0);
  });

  it('getModuleInfo returns commentary type', () => {
    const info = provider.getModuleInfo(handle);
    expect(info.type).toBe('commentary');
  });

  it('getCommentaryBooks returns mapped book numbers', () => {
    const books = provider.getCommentaryBooks(handle);
    expect(books).toBeInstanceOf(Array);
    expect(books.length).toBeGreaterThan(0);
    for (const bn of books) {
      expect(typeof bn).toBe('number');
    }
  });

  it('getCommentary returns content with verseFrom=1', async () => {
    const books = provider.getCommentaryBooks(handle);
    if (books.length === 0) return;
    const entries = await provider.getCommentary(handle, books[0], 1);
    expect(entries).toBeInstanceOf(Array);
    if (entries.length > 0) {
      expect(entries[0].verseFrom).toBe(1);
      expect(entries[0].verseTo).toBeNull();
      expect(entries[0].chapterTo).toBeNull();
      expect(entries[0].text.length).toBeGreaterThan(0);
    }
  });
});

describe('TWM type=1 (dictionary)', () => {
  let handle;

  beforeAll(() => {
    handle = provider.load(type1File);
  });

  afterAll(() => {
    if (handle) provider.close(handle);
  });

  it('loads as dictionary module', () => {
    expect(handle).toBeTruthy();
    expect(handle.format).toBe('theword-twm');
    expect(handle.isDictionary).toBe(true);
  });

  it('getModuleInfo returns dictionary type', () => {
    const info = provider.getModuleInfo(handle);
    expect(info.type).toBe('dictionary');
    expect(info.description).toBeTruthy();
    expect(typeof info.isStrongDict).toBe('boolean');
  });

  it('hasDictionaryTable returns true', () => {
    expect(provider.hasDictionaryTable(handle)).toBe(true);
  });

  it('searchDictionaryTopics returns matching topics', () => {
    // Use empty prefix to match any topic in the dictionary
    const topics = provider.searchDictionaryTopics(handle, '', 10);
    expect(topics).toBeInstanceOf(Array);
    expect(topics.length).toBeGreaterThan(0);
    for (const t of topics) {
      expect(typeof t).toBe('string');
    }
  });

  it('getDictionaryEntry returns entry with definition', () => {
    const topics = provider.searchDictionaryTopics(handle, '', 1);
    if (topics.length === 0) return;
    const entry = provider.getDictionaryEntry(handle, topics[0]);
    expect(entry).toBeTruthy();
    expect(entry.topic).toBe(topics[0]);
    expect(entry.definition).toBeTruthy();
    expect(typeof entry.definition).toBe('string');
    expect(entry.definition.length).toBeGreaterThan(0);
  });

  it('getDictionaryEntry returns null for missing topic', () => {
    const entry = provider.getDictionaryEntry(handle, 'NONEXISTENT_TOPIC_XYZ');
    expect(entry).toBeNull();
  });

  it('decodes compressed content_search blobs for Strong topics', () => {
    const strongHandle = provider.load(compressedStrongFile);
    try {
      expect(strongHandle).toBeTruthy();
      const entry = provider.getDictionaryEntry(strongHandle, 'G3588');
      expect(entry).toBeTruthy();
      expect(entry.topic).toBe('G3588');
      expect(entry.definition).toContain('artigo definido');
      expect(entry.definition).toContain('<p>');
    } finally {
      if (strongHandle) provider.close(strongHandle);
    }
  });
});

describe('isValidFile', () => {
  it('accepts type=2 .twm files', () => {
    expect(provider.isValidFile(type2File)).toBe(true);
  });

  it('accepts type=3 .twm files', () => {
    expect(provider.isValidFile(type3File)).toBe(true);
  });

  it('accepts type=1 .twm files', () => {
    expect(provider.isValidFile(type1File)).toBe(true);
  });

  it('rejects non-existent files', () => {
    expect(provider.isValidFile('/nonexistent/file.twm')).toBe(false);
  });
});
