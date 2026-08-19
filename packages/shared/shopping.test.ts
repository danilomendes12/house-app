import { describe, expect, it } from 'vitest';
import {
  SHOPPING_LISTS,
  SHOPPING_LIST_HINTS,
  SHOPPING_LIST_LABELS,
  isShoppingList,
} from './shopping';

describe('shopping lists', () => {
  it('is the pair the CHECK constraint allows', () => {
    // Guards the drift the mapper falls back on: shopping_items_list_valid in the migration
    // lists exactly these, and a third one added in SQL alone would land here first.
    expect([...SHOPPING_LISTS]).toEqual(['home', 'market']);
  });

  it('labels and describes every list', () => {
    for (const list of SHOPPING_LISTS) {
      expect(SHOPPING_LIST_LABELS[list]).toBeTruthy();
      expect(SHOPPING_LIST_HINTS[list]).toBeTruthy();
    }
  });

  it('rejects anything not a list', () => {
    // The guard stands between a URL segment and a database column, so junk matters.
    expect(isShoppingList('home')).toBe(true);
    expect(isShoppingList('market')).toBe(true);
    expect(isShoppingList('casa')).toBe(false);
    expect(isShoppingList('')).toBe(false);
    expect(isShoppingList('HOME')).toBe(false);
  });
});
