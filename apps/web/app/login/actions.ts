'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export type LoginState = { status: 'idle' } | { status: 'error'; message: string };

/**
 * Signs in with e-mail and password. Users are provisioned by script (`pnpm db:owner`,
 * `pnpm db:invite`); signups are disabled on the server and the database only accepts
 * allowlisted e-mails, so there is nothing to create here.
 *
 * The answer is deliberately the same for a wrong password and for an e-mail that does
 * not exist — otherwise this form would tell an outsider who has an account.
 */
export async function signIn(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase();
  const password = String(formData.get('password') ?? '');

  if (!email || !email.includes('@') || !password) {
    return { status: 'error', message: 'Informe e-mail e senha.' };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // 400 = wrong credentials, 422 = user does not exist / signups disabled.
    // Both get the same sentence: do not disclose which one happened.
    if (error.status === 400 || error.status === 422) {
      return { status: 'error', message: 'E-mail ou senha inválidos.' };
    }
    console.error('[auth] sign in failed', error.message);
    return { status: 'error', message: 'Não foi possível entrar agora. Tente de novo.' };
  }

  redirect('/');
}
