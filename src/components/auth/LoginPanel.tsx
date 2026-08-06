import { useState, type FormEvent } from 'react';
import { useHarnessStore } from '../../store';
import type { UserRole } from '../../types/collab';
import { ModalShell } from '../collab/ModalShell';

interface LoginPanelProps {
  onClose: () => void;
}

type Mode = 'login' | 'create';

export function LoginPanel({ onClose }: LoginPanelProps) {
  const login = useHarnessStore((state) => state.login);
  const createAccount = useHarnessStore((state) => state.createAccount);
  const [mode, setMode] = useState<Mode>('login');
  const [value, setValue] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<UserRole>('editor');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!value || submitting) return;
    setSubmitting(true);
    setError(null);
    const outcome = await login(value);
    setSubmitting(false);

    if (outcome.ok) {
      onClose();
      return;
    }

    switch (outcome.reason) {
      case 'rateLimited':
        setError('Too many attempts. Wait a minute and try again.');
        break;
      case 'unavailable':
        setError('Accounts are not enabled on this server.');
        break;
      case 'error':
        setError('Could not reach the server. Check your connection.');
        break;
      default:
        setError("That name wasn't recognised.");
    }
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!value || !displayName.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    const outcome = await createAccount(value, displayName.trim(), role);
    setSubmitting(false);

    if (outcome.ok) {
      onClose();
      return;
    }

    switch (outcome.reason) {
      case 'taken':
        setError('That login name is already taken. Try another.');
        break;
      case 'rateLimited':
        setError('Too many accounts created from here. Wait a minute and try again.');
        break;
      case 'unavailable':
        setError('Accounts are not enabled on this server.');
        break;
      case 'invalid':
        setError('Enter a login name and a display name.');
        break;
      default:
        setError('Could not reach the server. Check your connection.');
    }
  }

  if (mode === 'create') {
    return (
      <ModalShell title="Create your account" onClose={onClose}>
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label htmlFor="collaboration-signup-login" className="mb-1 block text-xs font-medium text-zinc-300">
              Login name
            </label>
            <input
              id="collaboration-signup-login"
              type="text"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              autoFocus
              className="w-full rounded border border-zinc-700 bg-zinc-950 px-2.5 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-amber-500"
              placeholder="Pick a private login name"
            />
            <p className="mt-1.5 text-xs text-zinc-500">
              This is your private credential — keep it to yourself. It's case sensitive and never shown to anyone else.
            </p>
          </div>

          <div>
            <label htmlFor="collaboration-signup-name" className="mb-1 block text-xs font-medium text-zinc-300">
              Display name
            </label>
            <input
              id="collaboration-signup-name"
              type="text"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              className="w-full rounded border border-zinc-700 bg-zinc-950 px-2.5 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-amber-500"
              placeholder="What everyone else sees"
            />
          </div>

          <div>
            <span className="mb-1 block text-xs font-medium text-zinc-300">Role</span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setRole('editor')}
                className={`flex-1 rounded border px-2.5 py-2 text-left text-xs transition-colors ${
                  role === 'editor'
                    ? 'border-amber-500 bg-amber-950/30 text-amber-200'
                    : 'border-zinc-700 bg-zinc-950 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <span className="block font-medium">Editor</span>
                <span className="block text-[10px] text-zinc-500">Can view and change the harness</span>
              </button>
              <button
                type="button"
                onClick={() => setRole('viewer')}
                className={`flex-1 rounded border px-2.5 py-2 text-left text-xs transition-colors ${
                  role === 'viewer'
                    ? 'border-amber-500 bg-amber-950/30 text-amber-200'
                    : 'border-zinc-700 bg-zinc-950 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <span className="block font-medium">Viewer</span>
                <span className="block text-[10px] text-zinc-500">Can only look around</span>
              </button>
            </div>
          </div>

          {error && (
            <p role="alert" className="rounded border border-red-900/70 bg-red-950/40 px-3 py-2 text-xs text-red-300">
              {error}
            </p>
          )}

          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => switchMode('login')}
              className="text-xs text-zinc-500 transition-colors hover:text-zinc-200"
            >
              Already have an account? Log in
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!value || !displayName.trim() || submitting}
                className="rounded bg-amber-500 px-3 py-1.5 text-xs font-medium text-zinc-950 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {submitting ? 'Creating…' : 'Create account'}
              </button>
            </div>
          </div>
        </form>
      </ModalShell>
    );
  }

  return (
    <ModalShell title="Log in to edit" onClose={onClose}>
      <form onSubmit={handleLogin} className="space-y-4">
        <div>
          <label htmlFor="collaboration-login" className="mb-1 block text-xs font-medium text-zinc-300">
            Login name
          </label>
          <input
            id="collaboration-login"
            type="text"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            autoFocus
            className="w-full rounded border border-zinc-700 bg-zinc-950 px-2.5 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-amber-500"
            placeholder="Enter your login name"
          />
          <p className="mt-1.5 text-xs text-zinc-500">Login names are case sensitive.</p>
        </div>

        {error && (
          <p role="alert" className="rounded border border-red-900/70 bg-red-950/40 px-3 py-2 text-xs text-red-300">
            {error}
          </p>
        )}

        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => switchMode('create')}
            className="text-xs text-zinc-500 transition-colors hover:text-zinc-200"
          >
            New here? Create an account
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!value || submitting}
              className="rounded bg-amber-500 px-3 py-1.5 text-xs font-medium text-zinc-950 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {submitting ? 'Logging in…' : 'Log in'}
            </button>
          </div>
        </div>
      </form>
    </ModalShell>
  );
}
