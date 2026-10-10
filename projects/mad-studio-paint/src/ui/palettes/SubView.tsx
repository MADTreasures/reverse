/**
 * Sub View palette, like the reference's: reference images to look at and pick colours from.
 * Import (button, palette menu, dropping files on the palette, Import from clipboard); with
 * Switch to eyedropper automatically on, clicking or dragging over the image picks the drawing
 * colour, off the hand pans it; the mouse wheel zooms. The command bar: zoom slider, zoom out/in,
 * Fit to Navigator, the eyedropper switch; rotation slider, rotate left/right (5°), reset
 * rotation, flip horizontal/vertical, previous/next image, the image list (pick, drag to reorder,
 * ×), import, open the image on a canvas, clear. The images stay when another canvas opens.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { handleDroppedFiles } from '../../io/documentIO';
import { rgbToHex } from '../../model/color';
import { clampZoom, fitZoom, ROTATE_STEP, wrapAngle, zoomStep } from '../../paint/subView';
import { apply, invert, viewMatrix } from '../../paint/viewMath';
import * as actions from '../../store/actions';
import {
  currentImage,
  fitSubView,
  importFromClipboard,
  importImages,
  moveImage,
  nextImage,
  previousImage,
  removeImage,
  setCommandBar,
  setEyedropper,
  setSubView,
  showImage,
  toggleImageList,
  useSubView,
  type SubImage,
} from '../../store/subView';
import { Icon } from '../controls/Icons';
import { Slider } from '../controls/Slider';
import { toast, type MenuItem } from '../overlays';

/** Import: a file dialog for one or more images. */
function pickImages(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.multiple = true;
  input.onchange = () => void importImages([...(input.files ?? [])].map((f) => ({ name: f.name, blob: f })));
  input.click();
}

async function fromClipboard(): Promise<void> {
  if (!(await importFromClipboard())) toast('The clipboard has no image', 'error');
}

/** Open the image on the canvas: a new canvas with a copy of the image. */
function openOnCanvas(img: SubImage | null = currentImage()): void {
  if (!img) return;
  const ext = img.blob.type.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
  const name = /\.[a-z0-9]+$/i.test(img.name) ? img.name : `${img.name}.${ext}`;
  void handleDroppedFiles([new File([img.blob], name, { type: img.blob.type })]);
}

export function subViewMenu(): MenuItem[] {
  const s = useSubView.getState();
  const img = currentImage(s);
  return [
    { label: 'Import…', onClick: pickImages },
    { label: 'Import from clipboard', onClick: () => void fromClipboard() },
    { separator: true },
    { label: 'Show command bar', checked: s.commandBar, onClick: () => setCommandBar(!s.commandBar) },
    { label: 'Switch to eyedropper automatically', checked: s.eyedropper, onClick: () => setEyedropper(!s.eyedropper) },
    { separator: true },
    { label: 'Open the image on the canvas', disabled: !img, onClick: () => openOnCanvas(img) },
    { label: 'Clear', disabled: !img, onClick: () => removeImage() },
  ];
}

/** The colour of an image pixel, or null outside the image or where it is transparent. */
function sampleImage(bitmap: ImageBitmap, x: number, y: number): string | null {
  if (x < 0 || y < 0 || x >= bitmap.width || y >= bitmap.height) return null;
  const c = new OffscreenCanvas(1, 1);
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(bitmap, Math.floor(x), Math.floor(y), 1, 1, 0, 0, 1, 1);
  const d = g.getImageData(0, 0, 1, 1).data;
  return d[3] === 0 ? null : rgbToHex({ r: d[0], g: d[1], b: d[2] });
}

function useSize<T extends HTMLElement>(): [React.RefObject<T | null>, { w: number; h: number }] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize((s) => (s.w === el.clientWidth && s.h === el.clientHeight ? s : { w: el.clientWidth, h: el.clientHeight }));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

function IconButton({ icon, label, onClick, on, disabled }: { icon: string; label: string; onClick: () => void; on?: boolean; disabled?: boolean }) {
  return (
    <button className={`icon-btn ${on ? 'on' : ''}`} title={label} aria-label={label} aria-pressed={on} disabled={disabled} onClick={onClick}>
      <Icon name={icon} size={15} />
    </button>
  );
}

/** The image list: thumbnails to pick (drag to reorder, × takes one out) and Import. */
function ImageList() {
  const { images, index } = useSubView(useShallow((s) => ({ images: s.images, index: s.index })));
  const [drag, setDrag] = useState<number | null>(null);
  return (
    <div className="subview-list" data-testid="subview-list" role="listbox" aria-label="Sub View images">
      {images.map((img, i) => (
        <div
          key={img.id}
          className={`subview-thumb ${i === index ? 'selected' : ''}`}
          role="option"
          aria-selected={i === index}
          title={img.name}
          draggable
          onDragStart={(e) => {
            setDrag(i);
            e.dataTransfer.effectAllowed = 'move';
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (drag !== null) moveImage(drag, i);
            setDrag(null);
          }}
          onClick={() => {
            showImage(i);
            toggleImageList();
          }}
        >
          <img src={img.url} alt={img.name} draggable={false} />
          <button
            className="subview-thumb-remove"
            title="Remove from the Sub View palette"
            aria-label={`Remove ${img.name}`}
            onClick={(e) => {
              e.stopPropagation();
              removeImage(i);
            }}
          >
            ×
          </button>
        </div>
      ))}
      <button className="subview-thumb add" title="Import" aria-label="Import images" onClick={pickImages}>
        +
      </button>
    </div>
  );
}

export function SubView() {
  const { view, eyedropper, commandBar, listOpen, count, index } = useSubView(
    useShallow((s) => ({ view: s.view, eyedropper: s.eyedropper, commandBar: s.commandBar, listOpen: s.listOpen, count: s.images.length, index: s.index })),
  );
  const img = useSubView((s) => currentImage(s));
  const [box, size] = useSize<HTMLDivElement>();
  const canvas = useRef<HTMLCanvasElement>(null);
  const imgSize = img ? { w: img.bitmap.width, h: img.bitmap.height } : { w: 1, h: 1 };
  const zoom = view.fit ? fitZoom(imgSize, size, view.rotation) : view.zoom;
  const matrix = viewMatrix({ ...view, zoom }, size, imgSize);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.max(1, Math.round(size.w * dpr));
    c.height = Math.max(1, Math.round(size.h * dpr));
    const g = c.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, c.width, c.height);
    if (!img) return;
    g.setTransform(dpr * matrix[0], dpr * matrix[1], dpr * matrix[2], dpr * matrix[3], dpr * matrix[4], dpr * matrix[5]);
    g.imageSmoothingEnabled = zoom < 2;
    g.imageSmoothingQuality = 'high';
    g.drawImage(img.bitmap, 0, 0);
  }, [img, size, matrix]);

  // The mouse wheel zooms (a native listener: the page must not scroll).
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (!currentImage()) return;
      e.preventDefault();
      const s = useSubView.getState();
      const z = s.view.fit && img ? fitZoom(imgSize, size, s.view.rotation) : s.view.zoom;
      setSubView({ fit: false, zoom: zoomStep(z, e.deltaY < 0 ? 1 : -1) });
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  });

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 || !img) return;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const b = el.getBoundingClientRect();
    if (eyedropper) {
      const inv = invert(matrix);
      const pick = (ev: { clientX: number; clientY: number }) => {
        const p = apply(inv, ev.clientX - b.left, ev.clientY - b.top);
        const hex = sampleImage(img.bitmap, p.x, p.y);
        if (hex) actions.setDrawingColor(hex);
      };
      pick(e);
      const move = (ev: PointerEvent) => pick(ev);
      const up = () => {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      return;
    }
    // The hand: drag to pan.
    const x0 = e.clientX;
    const y0 = e.clientY;
    const { panX, panY } = useSubView.getState().view;
    const move = (ev: PointerEvent) => setSubView({ panX: panX + ev.clientX - x0, panY: panY + ev.clientY - y0 });
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  const setZoom = (z: number) => setSubView({ fit: false, zoom: clampZoom(z) });
  return (
    <div
      className="subview"
      data-testid="subview"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault();
      }}
      onDrop={(e) => {
        const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'));
        if (!files.length) return;
        // Dropped on the palette: reference images, not a new canvas (the window's drop handler leaves it).
        e.preventDefault();
        void importImages(files.map((f) => ({ name: f.name, blob: f })));
      }}
    >
      <div ref={box} className="subview-image">
        <canvas
          ref={canvas}
          className={eyedropper ? 'picking' : 'panning'}
          data-testid="subview-canvas"
          data-image={img?.name ?? ''}
          data-zoom={zoom.toFixed(3)}
          data-rotation={view.rotation}
          data-flip={`${view.flipH ? 'h' : ''}${view.flipV ? 'v' : ''}`}
          style={{ width: size.w, height: size.h }}
          onPointerDown={onDown}
        />
        {!img && (
          <button className="subview-empty" onClick={pickImages}>
            Import an image to look at and pick colours from
          </button>
        )}
        {listOpen && <ImageList />}
      </div>
      {commandBar && (
        <div className="subview-bar" data-testid="subview-bar">
          <div className="subview-row">
            <Slider ariaLabel="Sub View zoom (%)" testId="subview-zoom" value={Math.round(zoom * 1000) / 10} min={1} max={3200} log step={0.1} decimals={1} onChange={(v) => setZoom(v / 100)} />
            <IconButton icon="zoomOut" label="Zoom out" onClick={() => setZoom(zoomStep(zoom, -1))} disabled={!img} />
            <IconButton icon="zoomIn" label="Zoom in" onClick={() => setZoom(zoomStep(zoom, 1))} disabled={!img} />
            <IconButton icon="fit" label="Fit to Navigator" on={view.fit} onClick={fitSubView} disabled={!img} />
            <span className="sep" />
            <IconButton icon="eyedropper" label="Switch to eyedropper automatically" on={eyedropper} onClick={() => setEyedropper(!eyedropper)} />
          </div>
          <div className="subview-row">
            <Slider ariaLabel="Sub View rotation (°)" testId="subview-rotation" value={view.rotation} min={-180} max={180} step={0.1} decimals={1} onChange={(v) => setSubView({ rotation: v })} />
            <IconButton icon="rotateLeft" label="Rotate left" onClick={() => setSubView({ rotation: wrapAngle(view.rotation - ROTATE_STEP) })} />
            <IconButton icon="rotateRight" label="Rotate right" onClick={() => setSubView({ rotation: wrapAngle(view.rotation + ROTATE_STEP) })} />
            <IconButton icon="resetRotation" label="Reset rotation" onClick={() => setSubView({ rotation: 0 })} />
            <IconButton icon="flipH" label="Flip horizontal" on={view.flipH} onClick={() => setSubView({ flipH: !view.flipH })} />
            <IconButton icon="flipV" label="Flip vertical" on={view.flipV} onClick={() => setSubView({ flipV: !view.flipV })} />
          </div>
          <div className="subview-row">
            <span className="subview-count" data-testid="subview-count">{count ? `${index + 1} / ${count}` : '0 / 0'}</span>
            <IconButton icon="framePrev" label="To previous image" onClick={previousImage} disabled={count < 2} />
            <IconButton icon="frameNext" label="To next image" onClick={nextImage} disabled={count < 2} />
            <IconButton icon="layer" label="Image list" on={listOpen} onClick={toggleImageList} />
            <span className="spacer" />
            <IconButton icon="open" label="Import" onClick={pickImages} />
            <IconButton icon="new" label="Open the image on the canvas" onClick={() => openOnCanvas()} disabled={!img} />
            <IconButton icon="trash" label="Clear" onClick={() => removeImage()} disabled={!img} />
          </div>
        </div>
      )}
    </div>
  );
}
