import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ModalShell } from '../collab/ModalShell';

type UserRole = 'admin' | 'editor' | 'viewer';

interface PublicUser {
  id: string;
  displayName: string;
  role: UserRole;
  color: string;
  createdAt: string;
}

interface UserAdminPanelProps {
  onClose: () => void;
}

async function responseError(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null) as { error?: string } | null;
  return body?.error || fallback;
}

function formatCreatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

interface UserRowProps {
  user: PublicUser;
  onSaved: (user: PublicUser) => void;
  onDeleted: (id: string) => void;
}

function UserRow({ user, onSaved, onDeleted }: UserRowProps) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [role, setRole] = useState<UserRole>(user.role);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/users/${encodeURIComponent(user.id)}`, {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: displayName.trim(), role }),
    }).catch(() => null);
    setBusy(false);
    if (!response) {
      setError('User changes could not reach the server.');
      return;
    }
    if (!response.ok) {
      const message = await responseError(response, 'Could not update this user.');
      setError(response.status === 409
        ? 'Cannot demote the last administrator.'
        : message);
      return;
    }
    const body = await response.json() as { user: PublicUser };
    onSaved(body.user);
    setEditing(false);
  }

  async function remove() {
    if (!window.confirm(`Delete ${user.displayName}? They will no longer be able to log in.`)) return;
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/users/${encodeURIComponent(user.id)}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    }).catch(() => null);
    setBusy(false);
    if (!response) {
      setError('The delete request could not reach the server.');
      return;
    }
    if (!response.ok) {
      const message = await responseError(response, 'Could not delete this user.');
      setError(response.status === 409
        ? 'Cannot delete the last administrator.'
        : message);
      return;
    }
    onDeleted(user.id);
  }

  if (editing) {
    return (
      <form onSubmit={save} className="rounded border border-zinc-700 bg-zinc-950/60 p-3">
        <div className="grid gap-2 sm:grid-cols-[1fr_120px]">
          <label className="text-xs text-zinc-400">
            Display name
            <input
              type="text"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              autoFocus
              className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 outline-none focus:border-amber-500"
            />
          </label>
          <label className="text-xs text-zinc-400">
            Role
            <select
              value={role}
              onChange={(event) => setRole(event.target.value as UserRole)}
              className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 outline-none focus:border-amber-500"
            >
              <option value="admin">Admin</option>
              <option value="editor">Editor</option>
              <option value="viewer">Viewer</option>
            </select>
          </label>
        </div>
        {error && <p role="alert" className="mt-2 text-xs text-red-300">{error}</p>}
        <div className="mt-3 flex items-center justify-between">
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            className="text-xs text-red-400 transition-colors hover:text-red-300 disabled:opacity-40"
          >
            Delete user
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setDisplayName(user.displayName);
                setRole(user.role);
                setError(null);
                setEditing(false);
              }}
              className="rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || !displayName.trim()}
              className="rounded bg-amber-500 px-2.5 py-1 text-xs font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-40"
            >
              Save
            </button>
          </div>
        </div>
      </form>
    );
  }

  return (
    <div className="flex items-center gap-3 rounded border border-zinc-800 bg-zinc-950/40 px-3 py-2.5">
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: user.color }}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-xs font-medium text-zinc-100">{user.displayName}</span>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] capitalize text-zinc-400">
            {user.role}
          </span>
        </div>
        <p className="mt-0.5 text-[10px] text-zinc-500">Created {formatCreatedAt(user.createdAt)}</p>
      </div>
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="rounded px-2 py-1 text-xs text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
      >
        Edit
      </button>
    </div>
  );
}

export function UserAdminPanel({ onClose }: UserAdminPanelProps) {
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [login, setLogin] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<UserRole>('editor');
  const [creating, setCreating] = useState(false);
  const [createdLogin, setCreatedLogin] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const loadUsers = useCallback(async () => {
    const response = await fetch('/api/users', {
      credentials: 'same-origin',
      cache: 'no-store',
    }).catch(() => null);
    setLoading(false);
    if (!response) {
      setError('Users could not be loaded.');
      return;
    }
    if (!response.ok) {
      setError(await responseError(response, 'Users could not be loaded.'));
      return;
    }
    setUsers(await response.json() as PublicUser[]);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    async function loadInitialUsers() {
      const response = await fetch('/api/users', {
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller.signal,
      }).catch(() => null);
      if (controller.signal.aborted) return;
      setLoading(false);
      if (!response) {
        setError('Users could not be loaded.');
        return;
      }
      if (!response.ok) {
        setError(await responseError(response, 'Users could not be loaded.'));
        return;
      }
      setUsers(await response.json() as PublicUser[]);
    }
    void loadInitialUsers();
    return () => controller.abort();
  }, []);

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const privateLogin = login;
    if (!privateLogin || !displayName.trim()) return;
    setCreating(true);
    setError(null);
    const response = await fetch('/api/users', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: privateLogin,
        displayName: displayName.trim(),
        role,
      }),
    }).catch(() => null);
    setCreating(false);
    if (!response) {
      setError('The new user could not be sent to the server.');
      return;
    }
    if (!response.ok) {
      const message = await responseError(response, 'Could not create this user.');
      setError(response.status === 409 ? 'That private login is already in use.' : message);
      return;
    }
    const body = await response.json() as { user: PublicUser };
    setUsers((current) => [...current, body.user]);
    setCreatedLogin(privateLogin);
    setCopied(false);
    setLogin('');
    setDisplayName('');
    setRole('editor');
  }

  async function copyCreatedLogin() {
    if (!createdLogin) return;
    try {
      await navigator.clipboard.writeText(createdLogin);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <ModalShell title="Manage users" onClose={onClose} widthClassName="w-[640px]">
      <div className="space-y-5">
        <form onSubmit={createUser} className="rounded border border-zinc-700 bg-zinc-950/50 p-3">
          <h3 className="text-xs font-semibold text-zinc-100">Create user</h3>
          <p className="mt-1 text-xs leading-relaxed text-zinc-500">
            The login is the private credential you give the person. The display name is what everyone sees in presence and activity.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-zinc-300">
              Private login
              <input
                type="text"
                value={login}
                onChange={(event) => setLogin(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 outline-none focus:border-amber-500"
              />
            </label>
            <label className="text-xs text-zinc-300">
              Public display name
              <input
                type="text"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 outline-none focus:border-amber-500"
              />
            </label>
          </div>
          <div className="mt-3 flex items-end justify-between gap-3">
            <label className="text-xs text-zinc-300">
              Role
              <select
                value={role}
                onChange={(event) => setRole(event.target.value as UserRole)}
                className="mt-1 block rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 outline-none focus:border-amber-500"
              >
                <option value="admin">Admin</option>
                <option value="editor">Editor</option>
                <option value="viewer">Viewer</option>
              </select>
            </label>
            <button
              type="submit"
              disabled={creating || !login || !displayName.trim()}
              className="rounded bg-amber-500 px-3 py-1.5 text-xs font-medium text-zinc-950 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {creating ? 'Creating…' : 'Create user'}
            </button>
          </div>
        </form>

        {createdLogin && (
          <div className="rounded border border-amber-700/60 bg-amber-950/30 p-3">
            <p className="text-xs font-medium text-amber-300">Give this login to the new user now.</p>
            <div className="mt-2 flex gap-2">
              <input
                type="text"
                readOnly
                value={createdLogin}
                className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 font-mono text-xs text-zinc-100"
              />
              <button
                type="button"
                onClick={copyCreatedLogin}
                className="rounded border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-200 hover:bg-zinc-700"
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <p className="mt-1.5 text-[10px] text-amber-400/80">The login will not be shown again.</p>
          </div>
        )}

        {error && (
          <p role="alert" className="rounded border border-red-900/70 bg-red-950/40 px-3 py-2 text-xs text-red-300">
            {error}
          </p>
        )}

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold text-zinc-100">Team members</h3>
            <button
              type="button"
              onClick={() => {
                setLoading(true);
                setError(null);
                void loadUsers();
              }}
              className="text-xs text-zinc-500 hover:text-zinc-200"
            >
              Refresh
            </button>
          </div>
          {loading ? (
            <p className="py-6 text-center text-xs text-zinc-500">Loading users…</p>
          ) : users.length === 0 ? (
            <p className="py-6 text-center text-xs text-zinc-500">No users found.</p>
          ) : (
            <div className="space-y-2">
              {users.map((user) => (
                <UserRow
                  key={user.id}
                  user={user}
                  onSaved={(saved) => setUsers((current) =>
                    current.map((candidate) => candidate.id === saved.id ? saved : candidate)
                  )}
                  onDeleted={(id) => setUsers((current) =>
                    current.filter((candidate) => candidate.id !== id)
                  )}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </ModalShell>
  );
}
