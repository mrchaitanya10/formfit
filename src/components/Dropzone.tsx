import { type DragEvent, useId, useState } from 'react';

interface Props {
  accept: string;
  multiple?: boolean;
  title: string;
  hint: string;
  compact?: boolean;
  onFiles: (files: File[]) => void;
}

/** Drag-and-drop target with a regular, keyboard-accessible file picker inside it. */
export function Dropzone({ accept, multiple = false, title, hint, compact = false, onFiles }: Props) {
  const inputId = useId();
  const [dragging, setDragging] = useState(false);

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    const files = Array.from(event.dataTransfer.files);
    if (files.length) onFiles(multiple ? files : files.slice(0, 1));
  }

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={`rounded-xl border-2 border-dashed text-center transition-colors ${compact ? 'px-4 py-4' : 'px-4 py-10'} ${
        dragging ? 'border-brand bg-blue-50' : 'border-navy-300 bg-white'
      }`}
    >
      <p className="text-sm font-semibold text-ink">{title}</p>
      <p className="mt-1 text-xs text-navy-500">{hint}</p>
      <label
        htmlFor={inputId}
        className="mt-3 inline-flex min-h-11 cursor-pointer items-center justify-center rounded-lg bg-brand px-4 text-sm font-medium text-white transition-colors hover:bg-brand-dark has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand"
      >
        {multiple ? 'Choose files' : 'Choose file'}
        <input
          id={inputId}
          type="file"
          accept={accept}
          multiple={multiple}
          className="sr-only"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            // Reset so choosing the same file again still fires a change event.
            event.target.value = '';
            if (files.length) onFiles(files);
          }}
        />
      </label>
      <p className="mt-2 hidden text-xs text-navy-500 sm:block">or drag and drop {multiple ? 'files' : 'a file'} here</p>
    </div>
  );
}
