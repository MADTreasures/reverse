import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CanvasSizeDialog, GaussianBlurDialog } from './dialogs/AdjustDialogs';
import { PressureDialog } from './dialogs/PressureDialog';
import { DivideFrameDialog, FrameTemplateDialog, NewFrameFolderDialog } from './dialogs/FrameDialogs';
import { NewToneDialog } from './dialogs/ToneDialog';
import { GradientDialog } from './dialogs/GradientDialog';
import { TonalDialog } from './dialogs/TonalDialog';
import { PreferencesDialog } from './dialogs/PreferencesDialog';
import { ExportDialog, PsdExportDialog } from './dialogs/ExportDialog';
import { AnimationExportDialog, OnionSkinDialog, TimelineSettingsDialog } from './dialogs/AnimationDialogs';
import { AboutDialog, ShortcutsDialog } from './dialogs/InfoDialogs';
import { NewCanvasDialog } from './dialogs/NewCanvasDialog';
import { closeDialog, closeMenu, useOverlays, type MenuItem } from './overlays';

/** Context menus, modal dialogs and toast notifications. */
export function OverlayHost() {
  const menu = useOverlays((s) => s.menu);
  const dialog = useOverlays((s) => s.dialog);
  const toasts = useOverlays((s) => s.toasts);

  useEffect(() => {
    if (!dialog) return;
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeDialog();
      }
    };
    window.addEventListener('keydown', esc, true);
    return () => window.removeEventListener('keydown', esc, true);
  }, [dialog]);

  return (
    <>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} />}
      {dialog && (
        <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && closeDialog()}>
          {dialog.kind === 'prompt' && <PromptDialog title={dialog.title} value={dialog.value} onDone={dialog.resolve} />}
          {dialog.kind === 'confirm' && (
            <div className="modal small" role="dialog" aria-label={dialog.title}>
              <h2>{dialog.title}</h2>
              <p>{dialog.message}</p>
              <div className="modal-actions">
                <button className="btn" onClick={() => dialog.resolve(false)}>
                  Cancel
                </button>
                <button className={`btn ${dialog.danger ? 'danger' : 'primary'}`} autoFocus onClick={() => dialog.resolve(true)}>
                  {dialog.okLabel}
                </button>
              </div>
            </div>
          )}
          {dialog.kind === 'custom' && dialog.id === 'newCanvas' && <NewCanvasDialog />}
          {dialog.kind === 'custom' && dialog.id === 'export' && <ExportDialog />}
          {dialog.kind === 'custom' && dialog.id === 'exportPsd' && <PsdExportDialog />}
          {dialog.kind === 'custom' && dialog.id === 'timelineSettings' && <TimelineSettingsDialog />}
          {dialog.kind === 'custom' && dialog.id === 'onionSkin' && <OnionSkinDialog />}
          {dialog.kind === 'custom' && dialog.id === 'exportGif' && <AnimationExportDialog format="gif" />}
          {dialog.kind === 'custom' && dialog.id === 'exportApng' && <AnimationExportDialog format="apng" />}
          {dialog.kind === 'custom' && dialog.id === 'exportSequence' && <AnimationExportDialog format="sequence" />}
          {dialog.kind === 'custom' && dialog.id === 'about' && <AboutDialog />}
          {dialog.kind === 'custom' && dialog.id === 'shortcuts' && <ShortcutsDialog />}
          {dialog.kind === 'tonal' && <TonalDialog target={dialog.target} />}
          {dialog.kind === 'custom' && dialog.id === 'pressure' && <PressureDialog />}
          {dialog.kind === 'custom' && dialog.id === 'gaussianBlur' && <GaussianBlurDialog />}
          {dialog.kind === 'custom' && dialog.id === 'preferences' && <PreferencesDialog />}
          {dialog.kind === 'custom' && dialog.id === 'canvasSize' && <CanvasSizeDialog mode="canvas" />}
          {dialog.kind === 'custom' && dialog.id === 'imageResolution' && <CanvasSizeDialog mode="resolution" />}
          {dialog.kind === 'custom' && dialog.id === 'newFrameFolder' && <NewFrameFolderDialog />}
          {dialog.kind === 'custom' && dialog.id === 'divideFrame' && <DivideFrameDialog />}
          {dialog.kind === 'custom' && dialog.id === 'frameTemplates' && <FrameTemplateDialog />}
          {dialog.kind === 'custom' && dialog.id === 'newTone' && <NewToneDialog />}
          {dialog.kind === 'custom' && dialog.id === 'gradient' && <GradientDialog />}
        </div>
      )}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </>
  );
}

function PromptDialog({ title, value, onDone }: { title: string; value: string; onDone: (v: string | null) => void }) {
  const [text, setText] = useState(value);
  return (
    <form
      className="modal small"
      role="dialog"
      aria-label={title}
      onSubmit={(e) => {
        e.preventDefault();
        onDone(text);
      }}
    >
      <h2>{title}</h2>
      <input className="prompt-input" autoFocus value={text} onChange={(e) => setText(e.target.value)} onFocus={(e) => e.target.select()} />
      <div className="modal-actions">
        <button type="button" className="btn" onClick={() => onDone(null)}>
          Cancel
        </button>
        <button type="submit" className="btn primary">
          OK
        </button>
      </div>
    </form>
  );
}

function ContextMenu({ x, y, items }: { x: number; y: number; items: MenuItem[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  useLayoutEffect(() => {
    const r = ref.current!.getBoundingClientRect();
    setPos({ x: Math.min(x, window.innerWidth - r.width - 4), y: Math.min(y, window.innerHeight - r.height - 4) });
  }, [x, y]);
  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) closeMenu();
    };
    window.addEventListener('pointerdown', close, true);
    return () => window.removeEventListener('pointerdown', close, true);
  }, []);
  return (
    <div className="context-menu" ref={ref} style={{ left: pos.x, top: pos.y }} role="menu">
      {items.map((it, i) =>
        it.separator ? (
          <div key={i} className="menu-sep" />
        ) : (
          <button
            key={i}
            role="menuitem"
            className="menu-item"
            disabled={it.disabled}
            onClick={() => {
              closeMenu();
              it.onClick?.();
            }}
          >
            <span className="menu-check">{it.checked ? '✓' : ''}</span>
            <span className="menu-label">{it.label}</span>
            <span className="menu-shortcut">{it.shortcut ?? ''}</span>
          </button>
        ),
      )}
    </div>
  );
}
