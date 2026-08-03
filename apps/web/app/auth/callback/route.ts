import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { getSiteUrl } from '@/lib/site-url';

/**
 * Landing point for the magic link.
 *
 * Supabase sends either `?code=` (PKCE, default e-mail template) or
 * `?token_hash=&type=` (custom template using `{{ .TokenHash }}`); both are accepted.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const siteUrl = await getSiteUrl();

  const code = searchParams.get('code');
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  // Only same-site paths, so the link cannot be turned into an open redirect.
  const nextParam = searchParams.get('next');
  const next = nextParam?.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/';

  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, siteUrl));
    console.error('[auth] code exchange failed', error.message);
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(new URL(next, siteUrl));
    console.error('[auth] otp verification failed', error.message);
  }

  return NextResponse.redirect(new URL('/login?error=auth', siteUrl));
}
