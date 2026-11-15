import { useEffect, useRef, useState, type ChangeEvent } from 'react';

const MAX_PAGES = 30; // Matches the analyzer's per-document OCR page limit.
const MAX_BYTES = 20 * 1024 * 1024;

async function pageJpeg(file: File): Promise<ArrayBuffer> {
  let source: Blob = file;
  if (/\.(heic|heif)$/i.test(file.name) || /^image\/hei[cf]$/.test(file.type)) {
    const convert = (await import('heic2any')).default;
    const result = await convert({ blob: file, toType: 'image/jpeg', quality: 0.9 });
    source = Array.isArray(result) ? result[0] : result;
  }
  const bitmap = await createImageBitmap(source);
  try {
    const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image processing unavailable');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const jpeg = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Image conversion failed')), 'image/jpeg', 0.88),
    );
    return jpeg.arrayBuffer();
  } finally {
    bitmap.close();
  }
}

function PagePreview({ file }: { file: File }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url ? <img src={url} alt="" className="h-14 w-12 object-contain" /> : null;
}

export default function PaperDocumentScanner({ onUpload, disabled }: {
  onUpload: (files: File[]) => Promise<void>;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [pages, setPages] = useState<{ id: number; file: File }[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const capture = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const nextId = useRef(0);

  function addPages(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    if (!selected.length) return;
    if (pages.length + selected.length > MAX_PAGES) {
      setError('You can scan up to 30 pages in one document.');
      return;
    }
    setError('');
    setPages([...pages, ...selected.map(file => ({ id: ++nextId.current, file }))]);
  }

  function move(index: number, offset: number) {
    const next = [...pages];
    const [page] = next.splice(index, 1);
    next.splice(index + offset, 0, page);
    setPages(next);
  }

  async function finish() {
    if (busy || disabled || !title.trim() || !pages.length) return;
    setBusy(true);
    setError('');
    try {
      const { PDFDocument } = await import('pdf-lib');
      const pdf = await PDFDocument.create();
      pdf.setTitle(title.trim());
      for (const [index, { file }] of pages.entries()) {
        const bytes = await pageJpeg(file).catch(() => {
          throw new Error(`Page ${index + 1} could not be opened. Retake it or choose a JPEG or PNG.`);
        });
        const image = await pdf.embedJpg(bytes);
        const page = pdf.addPage([image.width, image.height]);
        page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
      }
      const bytes = await pdf.save();
      if (bytes.length > MAX_BYTES) {
        setError('This scan exceeds 20 MB. Retake the pages at a lower resolution and try again.');
        return;
      }
      await onUpload([new File([new Uint8Array(bytes)], title.trim().replace(/\.pdf$/i, '') + '.pdf', {
        type: 'application/pdf',
      })]);
      setTitle('');
      setPages([]);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not finish the document. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return <div className="space-y-2 text-xs">
    <button type="button" className="font-semibold text-brand-900 underline" disabled={busy}
      aria-expanded={open} onClick={() => setOpen(!open)}>Scan Paper Document</button>
    {open && <fieldset disabled={busy} className="space-y-2 rounded-lg border border-slate-200 p-3">
      <legend className="font-semibold">One paper document</legend>
      <p>Add every page of the same document in order, then finish it as one PDF.</p>
      <label className="block">Document title
        <input className="block w-full rounded border border-slate-300 p-2" value={title}
          maxLength={160} onChange={event => setTitle(event.target.value)} placeholder="e.g. CAS affidavit" />
      </label>
      <input hidden ref={capture} type="file" accept="image/*" capture="environment" onChange={addPages} />
      <input hidden ref={gallery} type="file" accept="image/*,.heic,.heif" multiple onChange={addPages} />
      <div className="flex flex-wrap gap-3">
        <button type="button" className="underline" onClick={() => capture.current?.click()}>Take Photo</button>
        <button type="button" className="underline" onClick={() => gallery.current?.click()}>Choose Photos</button>
      </div>
      <ol className="space-y-2">
        {pages.map(({ id, file }, index) => <li key={id} className="flex flex-wrap items-center gap-2">
          <PagePreview file={file} />
          <span>Page {index + 1}</span>
          <button type="button" disabled={index === 0} onClick={() => move(index, -1)}
            aria-label={`Move page ${index + 1} up`}>↑</button>
          <button type="button" disabled={index === pages.length - 1} onClick={() => move(index, 1)}
            aria-label={`Move page ${index + 1} down`}>↓</button>
          <button type="button" className="underline" aria-label={`Remove page ${index + 1}`}
            onClick={() => setPages(pages.filter(page => page.id !== id))}>Remove</button>
        </li>)}
      </ol>
      {error && <p role="alert" className="text-rose-800">{error}</p>}
      <button type="button" onClick={() => void finish()} disabled={busy || disabled || !pages.length || !title.trim()}
        className="rounded bg-brand-900 px-3 py-2 font-semibold text-white disabled:opacity-50">
        {busy ? 'Finishing document…' : 'Finish Document'}
      </button>
    </fieldset>}
  </div>;
}
