import { useEffect, useRef, useState } from 'react';

interface Props {
  onPick: (filename: string) => void;
  onClose: () => void;
  listEndpoint?: string; // default '/api/list-assets'
  baseUrl?: string;      // default '/img-assets/'
}

export function ImagePickerPanel({ onPick, onClose, listEndpoint = '/api/list-assets', baseUrl = '/img-assets/' }: Props) {
  const [assets, setAssets] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(listEndpoint)
      .then((r) => r.json() as Promise<string[]>)
      .then((files) => { setAssets(files); setLoading(false); })
      .catch(() => setLoading(false));
  }, [listEndpoint]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute z-50 bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl p-3 w-64"
      style={{ top: 40, right: 0 }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] text-zinc-400 font-medium">Pick background image</span>
        <button
          onClick={onClose}
          className="text-zinc-500 hover:text-zinc-300 text-xs px-1"
        >
          ✕
        </button>
      </div>

      {loading && (
        <div className="text-[10px] text-zinc-500 italic py-2 text-center">Loading…</div>
      )}
      {!loading && assets.length === 0 && (
        <div className="text-[10px] text-zinc-500 italic py-2 text-center">
          No images found in<br />
          <span className="font-mono">img_assets_besides_connectors/</span>
        </div>
      )}
      {!loading && assets.length > 0 && (
        <div className="grid grid-cols-3 gap-1.5 max-h-56 overflow-y-auto">
          {assets.map((filename) => (
            <button
              key={filename}
              onClick={() => { onPick(filename); onClose(); }}
              className="group relative aspect-square rounded overflow-hidden border border-zinc-700 hover:border-amber-500 transition-colors bg-zinc-800"
              title={filename}
            >
              <img
                src={`${baseUrl}${filename}`}
                alt={filename}
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-x-0 bottom-0 bg-black/70 text-[8px] text-zinc-300 px-0.5 py-0.5 truncate opacity-0 group-hover:opacity-100 transition-opacity">
                {filename}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
