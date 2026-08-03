'use server';

import { createClient } from '@/lib/supabase/server';
import { getSiteUrl } from '@/lib/site-url';

export type LoginState =
  { status: 'idle' } | { status: 'sent'; email: string } | { status: 'error'; message: string };

/**
 * Sends a magic link. Signups are disabled (`shouldCreateUser: false`) and the database
 * only accepts the owner's e-mail, so this is a no-op for anyone else — and the response
 * is deliberately identical either way.
 */
export async function requestMagicLink(
  _previous: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase();

  if (!email || !email.includes('@')) {
    return { status: 'error', message: 'Informe um e-mail válido.' };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: `${await getSiteUrl()}/auth/callback`,
    },
  });

  if (error && error.status !== 422) {
    // 422 = user does not exist / signups disabled. Do not disclose that.
    console.error('[auth] magic link request failed', error.message);
    return { status: 'error', message: 'Não foi possível enviar o link agora. Tente de novo.' };
  }

  return { status: 'sent', email };
}
