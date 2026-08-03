import { LoginForm } from './login-form';

export const metadata = {
  title: 'Entrar · Finanças',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight">Finanças</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          Acesso restrito. Enviaremos um link de entrada para o seu e-mail.
        </p>

        {error ? (
          <p
            role="alert"
            className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400"
          >
            Link inválido ou expirado. Peça um novo.
          </p>
        ) : null}

        <LoginForm />
      </div>
    </main>
  );
}
