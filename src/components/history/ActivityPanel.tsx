import { useEffect, useState, type FormEvent } from 'react';
import { useHarnessStore } from '../../store';
import { ModalShell } from '../collab/ModalShell';

type ActivityResponse = Record<string, Record<string, number>>;

interface ActivityPanelProps {
  harness: string;
  onClose: () => void;
}

async function responseError(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null) as { error?: string } | null;
  return body?.error || fallback;
}

function formatDate(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

export function ActivityPanel({ harness, onClose }: ActivityPanelProps) {
  const sessionUser = useHarnessStore((state) => state.session.user);
  const [days, setDays] = useState(30);
  const [activity, setActivity] = useState<ActivityResponse>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [login, setLogin] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [creating, setCreating] = useState(false);
  const [memberError, setMemberError] = useState<string | null>(null);
  const [createdLogin, setCreatedLogin] = useState<string | null>(null);
  const [createdDisplayName, setCreatedDisplayName] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!sessionUser) {
      onClose();
    }
  }, [onClose, sessionUser]);

  useEffect(() => {
    if (!sessionUser) return;
    const controller = new AbortController();
    async function loadActivity() {
      setLoading(true);
      setError(null);
      const response = await fetch(
        `/api/activity?harness=${encodeURIComponent(harness)}&days=${days}`,
        {
          credentials: 'same-origin',
          cache: 'no-store',
          signal: controller.signal,
        },
      ).catch(() => null);
      if (controller.signal.aborted) return;
      setLoading(false);
      if (!response) {
        setError('Activity could not be loaded.');
        return;
      }
      if (!response.ok) {
        setError('Activity could not be loaded.');
        return;
      }
      setActivity(await response.json() as ActivityResponse);
    }
    void loadActivity();
    return () => controller.abort();
  }, [days, harness, sessionUser]);

  if (!sessionUser) return null;

  const entries = Object.entries(activity).sort(([left], [right]) => right.localeCompare(left));

  async function createMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const privateLogin = login.trim();
    const publicName = displayName.trim();
    if (!privateLogin || !publicName) return;
    setCreating(true);
    setMemberError(null);
    const response = await fetch('/api/users', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: privateLogin,
        displayName: publicName,
        role: 'editor',
      }),
    }).catch(() => null);
    setCreating(false);
    if (!response) {
      setMemberError('The new member could not be sent to the server.');
      return;
    }
    if (!response.ok) {
      const message = await responseError(response, 'Could not add this member.');
      setMemberError(response.status === 409 ? 'That login is already in use.' : message);
      return;
    }
    setCreatedLogin(privateLogin);
    setCreatedDisplayName(publicName);
    setCopied(false);
    setLogin('');
    setDisplayName('');
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
    <ModalShell title="Activity" onClose={onClose} widthClassName="w-[520px]">
      <div className="space-y-5">
        <section className="rounded border border-zinc-700 bg-zinc-950/50 p-3">
          <h3 className="text-xs font-semibold text-zinc-100">Add member</h3>
          <p className="mt-1 text-[10px] leading-relaxed text-zinc-500">
            The login is the private credential you share with them. The display name is what everyone sees in activity and presence.
          </p>
          <form onSubmit={createMember} className="mt-3 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-zinc-300">
                Display name
                <input
                  type="text"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  autoComplete="off"
                  className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 outline-none focus:border-amber-500"
                />
              </label>
              <label className="text-xs text-zinc-300">
                Username login
                <input
                  type="text"
                  value={login}
                  onChange={(event) => setLogin(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 outline-none focus:border-amber-500"
                />
              </label>
            </div>
            {memberError && (
              <p role="alert" className="text-xs text-red-300">{memberError}</p>
            )}
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={creating || !login.trim() || !displayName.trim()}
                className="rounded bg-amber-500 px-3 py-1.5 text-xs font-medium text-zinc-950 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {creating ? 'Adding…' : 'Add member'}
              </button>
            </div>
          </form>
          {createdLogin && (
            <div className="mt-3 rounded border border-amber-700/60 bg-amber-950/30 p-3">
              <p className="text-xs font-medium text-amber-300">
                {createdDisplayName ? `${createdDisplayName} added.` : 'Member added.'} Give them this login now.
              </p>
              <div className="mt-2 flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={createdLogin}
                  className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 font-mono text-xs text-zinc-100"
                />
                <button
                  type="button"
                  onClick={() => void copyCreatedLogin()}
                  className="rounded border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-200 hover:bg-zinc-700"
                >
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <p className="mt-1.5 text-[10px] text-amber-400/80">The login will not be shown again.</p>
            </div>
          )}
        </section>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xs font-semibold text-zinc-100">Changes saved</h3>
              <p className="mt-0.5 text-[10px] text-zinc-500">Grouped by day and person</p>
            </div>
            <label className="text-xs text-zinc-500">
              Show
              <select
                value={days}
                onChange={(event) => setDays(Number(event.target.value))}
                className="ml-2 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-200 outline-none focus:border-amber-500"
              >
                <option value={7}>7 days</option>
                <option value={30}>30 days</option>
                <option value={90}>90 days</option>
              </select>
            </label>
          </div>

          {error && (
            <p role="alert" className="rounded border border-red-900/70 bg-red-950/40 px-3 py-2 text-xs text-red-300">
              {error}
            </p>
          )}

          {loading ? (
            <p className="py-10 text-center text-xs text-zinc-500">Loading activity…</p>
          ) : entries.length === 0 ? (
            <p className="rounded border border-dashed border-zinc-800 py-10 text-center text-xs text-zinc-500">
              No saved changes in this period.
            </p>
          ) : (
            <div className="space-y-3">
              {entries.map(([date, people]) => (
                <section key={date} className="rounded border border-zinc-800 bg-zinc-950/40">
                  <header className="border-b border-zinc-800 px-3 py-2 text-xs font-medium text-zinc-300">
                    {formatDate(date)}
                  </header>
                  <div className="divide-y divide-zinc-800/70">
                    {Object.entries(people)
                      .sort(([, left], [, right]) => right - left)
                      .map(([name, count]) => (
                        <div key={name} className="flex items-center justify-between px-3 py-2">
                          <span className="text-xs text-zinc-300">{name}</span>
                          <span className="text-xs tabular-nums text-zinc-500">
                            {count} {count === 1 ? 'change saved' : 'changes saved'}
                          </span>
                        </div>
                      ))}
                  </div>
                </section>
              ))}
            </div>
          )}

          <p className="border-t border-zinc-800 pt-3 text-[10px] leading-relaxed text-zinc-500">
            This counts debounced save batches, not individual semantic edits, so it is an activity proxy rather than an edit count.
          </p>
        </div>
      </div>
    </ModalShell>
  );
}
