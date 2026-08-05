import { useEffect, type ReactNode } from 'react';

interface ModalShellProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  widthClassName?: string;
}

export function ModalShell({
  title,
  onClose,
  children,
  footer,
  widthClassName = 'w-96',
}: ModalShellProps) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        aria-label={title}
        aria-modal="true"
        role="dialog"
        className={`${widthClassName} max-w-[95vw] max-h-[90vh] overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl flex flex-col`}
      >
        <header className="flex items-center justify-between border-b border-zinc-700 px-4 py-3">
          <h2 className="text-sm font-semibold text-zinc-100">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-400 transition-colors hover:text-zinc-100"
            aria-label={`Close ${title}`}
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
        {footer && (
          <footer className="flex justify-end border-t border-zinc-700 px-4 py-3">
            {footer}
          </footer>
        )}
      </section>
    </div>
  );
}
