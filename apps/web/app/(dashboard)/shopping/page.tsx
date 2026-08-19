import { redirect } from 'next/navigation';

/**
 * `/shopping` is not a page — the tab bar points straight at `/shopping/home`. This exists
 * so a typed URL or an old bookmark lands on a list instead of a 404.
 */
export default function ShoppingIndexPage() {
  redirect('/shopping/home');
}
