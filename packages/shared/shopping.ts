/**
 * The two shopping lists (SPEC §6.5).
 *
 * The identifiers are English and the labels are pt-BR, like every other union in here:
 * `list` is a column value and a route segment, the label is what the tab bar says.
 */

export const SHOPPING_LISTS = ['home', 'market'] as const;

export type ShoppingList = (typeof SHOPPING_LISTS)[number];

/** UI labels (pt-BR), in the order the page offers them. */
export const SHOPPING_LIST_LABELS: Record<ShoppingList, string> = {
  home: 'Casa',
  market: 'Mercado',
};

/** What each list is for, one line — the page prints it under the heading. */
export const SHOPPING_LIST_HINTS: Record<ShoppingList, string> = {
  home: 'O que falta para a casa: lâmpada, pilha, pano de prato.',
  market: 'A lista do supermercado: leva no celular e vai marcando.',
};

export function isShoppingList(value: string): value is ShoppingList {
  return (SHOPPING_LISTS as readonly string[]).includes(value);
}
