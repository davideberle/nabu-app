import { SignInButton } from "./sign-in-button";

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950">
      <div className="w-full max-w-sm p-8">
        <div className="text-center mb-8">
          <span className="text-5xl mb-4 block">📜</span>
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
            Nabu
          </h1>
          <p className="text-zinc-500 dark:text-zinc-400 mt-2">
            Sign in to continue
          </p>
        </div>

        <SignInButton />

        <p className="text-center text-xs text-zinc-400 dark:text-zinc-500 mt-6">
          Only authorized accounts can sign in
        </p>
      </div>
    </div>
  );
}
