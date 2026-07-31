import { useEffect, useRef, useState } from 'react';

interface Props {
  onPick: (filename: string) => void;
  onClose: () => void;
  title?: string;
  listEndpoint?: string; // default '/api/list-assets'
  uploadEndpoint?: string; // default '/api/upload-image'
  baseUrl?: string;      // default '/user-data/images/'
}

const ACCEPTED = 'image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif';

async function uploadImage(file: File, uploadEndpoint: string): Promise<string> {
  const response = await fetch(
    `${uploadEndpoint}?filename=${encodeURIComponent(file.name)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    },
  );
  const data = await response.json().catch(() => ({})) as { filename?: string; error?: string };
  if (!response.ok || !data.filename) {
    throw new Error(data.error || `Upload failed (${response.status})`);
  }
  return data.filename;
}

export function ImagePickerPanel({
  onPick,
  onClose,
  title = 'Pick image',
  listEndpoint = '/api/list-assets',
  uploadEndpoint = '/api/upload-image',
  baseUrl = '/user-data/images/',
}: Props) {
  const [assets, setAssets] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  // Bust stale browser caches of SPA HTML that Vite used to return for new uploads.
  const [cacheBust, setCacheBust] = useState(() => Date.now());
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  async function refreshAssets() {
    setLoading(true);
    try {
      const files = await fetch(listEndpoint).then((r) => r.json() as Promise<string[]>);
      setAssets(files);
      setCacheBust(Date.now());
    } catch {
      setAssets([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshAssets();
  }, [listEndpoint]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function handleFiles(files: FileList | File[] | null) {
    const file = files?.[0];
    if (!file) return;

    if (!/\.(png|jpe?g|webp|gif)$/i.test(file.name)) {
      setError('Use a PNG, JPG, WebP, or GIF image.');
      return;
    }

    setError(null);
    setUploading(true);
    try {
      const filename = await uploadImage(file, uploadEndpoint);
      setAssets((prev) => (prev.includes(filename) ? prev : [filename, ...prev]));
      onPick(filename);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div
      ref={ref}
      className="absolute z-50 bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl p-3 w-72"
      style={{ top: 40, right: 0 }}
      onMouseDown={(e) => e.stopPropagation()}
      onDragEnter={(e) => {
        e.preventDefault();
        e.stopPropagation();
        dragDepth.current += 1;
        setDragOver(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        e.stopPropagation();
        dragDepth.current -= 1;
        if (dragDepth.current <= 0) {
          dragDepth.current = 0;
          setDragOver(false);
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        dragDepth.current = 0;
        setDragOver(false);
        if (!uploading) void handleFiles(e.dataTransfer.files);
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] text-zinc-400 font-medium">{title}</span>
        <button
          onClick={onClose}
          className="text-zinc-500 hover:text-zinc-300 text-xs px-1"
          type="button"
        >
          ✕
        </button>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED}
        className="hidden"
        disabled={uploading}
        onChange={(e) => void handleFiles(e.target.files)}
      />

      <button
        type="button"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
        className={`w-full mb-2 rounded-md border border-dashed px-3 py-3 text-center transition-colors ${
          dragOver
            ? 'border-amber-500 bg-amber-500/10 text-amber-200'
            : uploading
              ? 'border-zinc-700 bg-zinc-800/60 text-zinc-500 cursor-wait'
              : 'border-zinc-600 bg-zinc-800/40 text-zinc-300 hover:border-amber-500 hover:bg-amber-500/5 hover:text-amber-200'
        }`}
      >
        <div className="text-[11px] font-medium">
          {uploading ? 'Uploading…' : dragOver ? 'Drop to upload' : 'Drop a photo here'}
        </div>
        <div className="text-[10px] text-zinc-500 mt-0.5">
          {uploading ? 'Saving to the server' : 'or click to choose a file'}
        </div>
      </button>

      {error && (
        <div className="mb-2 text-[10px] text-red-400 bg-red-950/40 border border-red-900/50 rounded px-2 py-1.5">
          {error}
        </div>
      )}

      {loading && (
        <div className="text-[10px] text-zinc-500 italic py-2 text-center">Loading…</div>
      )}
      {!loading && assets.length === 0 && !uploading && (
        <div className="text-[10px] text-zinc-500 italic py-2 text-center">
          No images yet — upload one above.
        </div>
      )}
      {!loading && assets.length > 0 && (
        <div className="grid grid-cols-3 gap-1.5 max-h-56 overflow-y-auto">
          {assets.map((filename) => (
            <button
              key={filename}
              type="button"
              onClick={() => { onPick(filename); onClose(); }}
              className="group relative aspect-square rounded overflow-hidden border border-zinc-700 hover:border-amber-500 transition-colors bg-zinc-800"
              title={filename}
            >
              <img
                src={`${baseUrl}${encodeURIComponent(filename)}?v=${cacheBust}`}
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
