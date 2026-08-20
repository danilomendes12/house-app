import { LoginForm } from './login-form';

export const metadata = {
  title: 'Entrar · App da casa',
};

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight">App da casa</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          Acesso restrito. Entre com o e-mail e a senha da casa.
        </p>

        <LoginForm />
      </div>
    </main>
  );
}
