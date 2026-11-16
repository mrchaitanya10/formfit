import { type KeyboardEvent, type PointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  type CropState,
  type LoadedImage,
  MAX_ZOOM,
  clampCrop,
  context2d,
  createCanvas,
  cropGeometry,
  drawCrop,
  releaseCanvas,
} from '../lib/image';
import { Button } from './ui';

interface Props {
  image: LoadedImage;
  outW: number;
  outH: number;
  crop: CropState;
  /** Fill colour shown behind the image; null shows transparency as a checkerboard. */
  background: string | null;
  onChange: (crop: CropState) => void;
}

const PREVIEW_LONG_EDGE = 1600;
const MAX_DISPLAY_HEIGHT = 420;

/**
 * The frame always has the shape of the requested output. Drag the image to choose what is
 * inside it; what you see in the frame is what gets exported.
 */
export function CropEditor({ image, outW, outH, crop, background, onChange }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const cropRef = useRef(crop);
  cropRef.current = crop;
  const [wrapWidth, setWrapWidth] = useState(0);

  // A smaller copy keeps dragging smooth with very large photos.
  const preview = useMemo(() => {
    const scale = Math.min(1, PREVIEW_LONG_EDGE / Math.max(image.width, image.height));
    const canvas = createCanvas(image.width * scale, image.height * scale);
    context2d(canvas).drawImage(image.bitmap, 0, 0, canvas.width, canvas.height);
    return canvas;
  }, [image]);
  useEffect(() => () => releaseCanvas(preview), [preview]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const observer = new ResizeObserver(() => setWrapWidth(wrap.clientWidth));
    observer.observe(wrap);
    setWrapWidth(wrap.clientWidth);
    return () => observer.disconnect();
  }, []);

  const aspect = outW / outH;
  const displayW = Math.max(1, Math.min(wrapWidth, MAX_DISPLAY_HEIGHT * aspect));
  const displayH = displayW / aspect;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || wrapWidth === 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(displayW * dpr);
    canvas.height = Math.round(displayH * dpr);
    const ctx = context2d(canvas);
    ctx.setTransform(canvas.width / outW, 0, 0, canvas.height / outH, 0, 0);
    drawCrop(ctx, preview, image.width, image.height, outW, outH, crop, background);
  }, [preview, image, outW, outH, crop, background, displayW, displayH, wrapWidth]);

  const geometry = cropGeometry(image.width, image.height, outW, outH, crop.rotation);

  function update(next: CropState) {
    onChange(clampCrop(next, image.width, image.height, outW, outH));
  }

  // Wheel zoom needs a non-passive listener so the page does not scroll at the same time.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const current = cropRef.current;
      onChange(clampCrop({ ...current, zoom: current.zoom * Math.exp(-event.deltaY * 0.0015) }, image.width, image.height, outW, outH));
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [image, outW, outH, onChange]);

  function onPointerDown(event: PointerEvent<HTMLCanvasElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
  }

  function onPointerMove(event: PointerEvent<HTMLCanvasElement>) {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    const current = { x: event.clientX, y: event.clientY };
    if (pointers.current.size === 1) {
      update({
        ...cropRef.current,
        x: cropRef.current.x + (current.x - previous.x) / displayW,
        y: cropRef.current.y + (current.y - previous.y) / displayH,
      });
    } else if (pointers.current.size === 2) {
      // Pinch: compare the distance between the two fingers before and after this move.
      const other = [...pointers.current.entries()].find(([id]) => id !== event.pointerId)?.[1];
      if (other) {
        const before = Math.hypot(previous.x - other.x, previous.y - other.y);
        const after = Math.hypot(current.x - other.x, current.y - other.y);
        if (before > 0) update({ ...cropRef.current, zoom: cropRef.current.zoom * (after / before) });
      }
    }
    pointers.current.set(event.pointerId, current);
  }

  function onPointerEnd(event: PointerEvent<HTMLCanvasElement>) {
    pointers.current.delete(event.pointerId);
  }

  function onKeyDown(event: KeyboardEvent) {
    const step = event.shiftKey ? 0.05 : 0.01;
    const moves: Record<string, Partial<CropState>> = {
      ArrowLeft: { x: crop.x - step },
      ArrowRight: { x: crop.x + step },
      ArrowUp: { y: crop.y - step },
      ArrowDown: { y: crop.y + step },
      '+': { zoom: crop.zoom * 1.05 },
      '=': { zoom: crop.zoom * 1.05 },
      '-': { zoom: crop.zoom / 1.05 },
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    update({ ...crop, ...move });
  }

  // Rotation is stored as one angle; the controls split it into quarter turns plus a fine adjustment.
  const fine = ((((crop.rotation + 45) % 90) + 90) % 90) - 45;
  const quarter = crop.rotation - fine;
  const rotateBy = (degrees: number) => update({ ...crop, rotation: (((quarter + degrees) % 360) + 360) % 360 + fine });

  return (
    <div>
      <div ref={wrapRef} className="flex justify-center rounded-lg bg-navy-100 p-0">
        <canvas
          ref={canvasRef}
          tabIndex={0}
          role="img"
          aria-label="Crop area. Drag to move the image. Use the arrow keys to move and plus or minus to zoom."
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onKeyDown={onKeyDown}
          style={{ width: displayW, height: displayH }}
          className={`cursor-move touch-none rounded-sm ring-1 ring-navy-300 ${background ? '' : 'checkerboard'}`}
        />
      </div>
      <p className="mt-2 text-xs text-navy-500">
        The frame is the exported area. Drag to reposition; pinch, scroll or use the slider to zoom.
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium text-ink">
          Zoom
          <input
            type="range"
            min={geometry.minZoom}
            max={MAX_ZOOM}
            step={0.01}
            value={crop.zoom}
            onChange={(event) => update({ ...crop, zoom: Number(event.target.value) })}
            className="mt-1 block h-8 w-full accent-brand"
          />
        </label>
        <label className="block text-sm font-medium text-ink">
          Straighten <span className="font-normal text-navy-500 tabular-nums">{fine.toFixed(0)}°</span>
          <input
            type="range"
            min={-15}
            max={15}
            step={1}
            value={fine}
            onChange={(event) => update({ ...crop, rotation: quarter + Number(event.target.value) })}
            className="mt-1 block h-8 w-full accent-brand"
          />
        </label>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button small onClick={() => rotateBy(-90)}>
          Rotate left
        </Button>
        <Button small onClick={() => rotateBy(90)}>
          Rotate right
        </Button>
        <Button small onClick={() => update({ ...crop, zoom: 1, x: 0, y: 0 })}>
          Fill frame
        </Button>
        <Button small onClick={() => update({ ...crop, zoom: geometry.minZoom, x: 0, y: 0 })}>
          Fit whole image
        </Button>
      </div>
    </div>
  );
}
