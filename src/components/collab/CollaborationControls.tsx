import { useState } from 'react';
import { useHarnessStore } from '../../store';
import { LoginPanel } from '../auth/LoginPanel';
import { ActivityPanel } from '../history/ActivityPanel';
import { CheckpointPanel } from '../history/CheckpointPanel';
import { ConflictBanner } from './ConflictBanner';
import { SyncStatus } from './SyncStatus';

interface CollaborationControlsProps {
  harness: string;
}

function LogoutButton({ onLogout }: { onLogout: () => void }) {
  return (
    <button
      type="button"
      onClick={onLogout}
      className="p-1 text-zinc-500 transition-colors hover:text-zinc-100"
      title="Log out"
      aria-label="Log out"
    >
      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m10 17 5-5-5-5M15 12H3M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
      </svg>
    </button>
  );
}

export function CollaborationControls({ harness }: CollaborationControlsProps) {
  const session = useHarnessStore((state) => state.session);
  const activateEditSession = useHarnessStore((state) => state.activateEditSession);
  const logout = useHarnessStore((state) => state.logout);
  const [loginOpen, setLoginOpen] = useState(false);
  const [checkpointOpen, setCheckpointOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const assignedColor = session.user?.color ?? '#a1a1aa';

  return (
    <>
      <div className="flex shrink-0 items-center gap-2 border-l border-zinc-800 pl-2">
        <SyncStatus />

        <button
          type="button"
          onClick={() => setCheckpointOpen(true)}
          className="p-1 text-zinc-400 transition-colors hover:text-zinc-100"
          title="Checkpoints"
          aria-label="Open checkpoints"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 4h12l2 2v14H5z" />
            <path d="M8 4v6h8V4M8 20v-6h8v6" />
          </svg>
        </button>

        {session.user && (
          <button
            type="button"
            onClick={() => setActivityOpen(true)}
            className="p-1 text-zinc-400 transition-colors hover:text-zinc-100"
            title="Activity"
            aria-label="Open activity"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M5 20V10M12 20V4M19 20v-7" />
            </svg>
          </button>
        )}

        {!session.isEditor && (
          <span
            className="flex items-center gap-1 rounded border border-zinc-700 bg-zinc-950/70 px-1.5 py-0.5 text-[10px] text-zinc-400"
            title="Editing is disabled"
          >
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <rect x="5" y="10" width="14" height="10" rx="2" />
              <path d="M8 10V7a4 4 0 0 1 8 0v3" />
            </svg>
            Read only
          </span>
        )}

        {!session.user ? (
          <button
            type="button"
            onClick={() => setLoginOpen(true)}
            className="rounded border border-amber-700/70 bg-amber-950/30 px-2 py-1 text-xs text-amber-300 transition-colors hover:bg-amber-950/60 hover:text-amber-200"
          >
            Log in
          </button>
        ) : session.user.role === 'viewer' ? (
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: assignedColor }} aria-hidden="true" />
            <span className="max-w-32 truncate text-xs text-zinc-300" title={`Viewing as ${session.user.displayName}`}>
              Viewing · {session.user.displayName}
            </span>
            <LogoutButton onLogout={() => void logout()} />
          </div>
        ) : !session.editSessionActive ? (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={activateEditSession}
              className="rounded border border-amber-700/70 bg-amber-950/30 px-2 py-1 text-xs text-amber-300 transition-colors hover:bg-amber-950/60 hover:text-amber-200"
              title={`Continue as ${session.user.displayName} (E)`}
            >
              Continue as {session.user.displayName}
              <span className="ml-1.5 inline-flex min-w-[1.1rem] items-center justify-center rounded border border-amber-700/50 bg-amber-950/50 px-1 py-px font-mono text-[10px] leading-none text-amber-400/90">
                E
              </span>
            </button>
            <LogoutButton onLogout={() => void logout()} />
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: assignedColor }} aria-hidden="true" />
            <span className="max-w-28 truncate text-xs text-zinc-200" title={session.user.displayName}>
              {session.user.displayName}
            </span>
            <LogoutButton onLogout={() => void logout()} />
          </div>
        )}
      </div>

      {loginOpen && <LoginPanel onClose={() => setLoginOpen(false)} />}
      {checkpointOpen && (
        <CheckpointPanel
          harness={harness}
          isEditor={session.isEditor}
          onClose={() => setCheckpointOpen(false)}
        />
      )}
      {activityOpen && session.user && (
        <ActivityPanel harness={harness} onClose={() => setActivityOpen(false)} />
      )}
      <ConflictBanner />
    </>
  );
}
