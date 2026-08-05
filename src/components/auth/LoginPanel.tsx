import { useState, type FormEvent } from 'react';
import { useHarnessStore } from '../../store';
import { ModalShell } from '../collab/ModalShell';

interface LoginPanelProps {
  onClose: () => void;
}

export function LoginPanel({ onClose }: LoginPanelProps) {
  const login = useHarnessStore((state) => state.login);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [bootstrapNote, setBootstrapNote] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!value || submitting) return;
    setSubmitting(true);
    setError(null);
    const outcome = await login(value);
    setSubmitting(false);

    if (outcome.ok) {
      // First run on a fresh install: this account became the administrator.
      if (outcome.bootstrapAdmin) {
        setBootstrapNote(true);
        return;
      }
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

  if (bootstrapNote) {
    return (
      <ModalShell title="Administrator account created" onClose={onClose}>
        <div className="space-y-4">
          <p className="text-xs leading-relaxed text-zinc-300">
            This was the first login on a new install, so this account is now the
            <span className="text-amber-300"> administrator</span>. You can create
            accounts for the rest of the team from the people icon in the toolbar.
          </p>
          <p className="text-xs leading-relaxed text-zinc-500">
            Keep this login name private — it is the only credential.
          </p>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded bg-amber-500 px-3 py-1.5 text-xs font-medium text-zinc-950 transition-colors hover:bg-amber-400"
            >
              Got it
            </button>
          </div>
        </div>
      </ModalShell>
    );
  }

  return (
    <ModalShell title="Log in to edit" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
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
            placeholder="Enter the name you were given"
          />
          <p className="mt-1.5 text-xs text-zinc-500">Login names are case sensitive.</p>
        </div>

        {error && (
          <p role="alert" className="rounded border border-red-900/70 bg-red-950/40 px-3 py-2 text-xs text-red-300">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
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
      </form>
    </ModalShell>
  );
}
