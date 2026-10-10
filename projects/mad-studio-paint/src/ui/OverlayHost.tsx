import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CanvasSizeDialog } from './dialogs/AdjustDialogs';
import { FilterDialog } from './dialogs/FilterDialog';
import { filterSpec } from '../paint/filters';
import { PressureDialog } from './dialogs/PressureDialog';
import { DivideFrameDialog, DrawAlongRulerDialog, FrameTemplateDialog, NewFrameFolderDialog } from './dialogs/FrameDialogs';
import { NewToneDialog } from './dialogs/ToneDialog';
import { GradientDialog } from './dialogs/GradientDialog';
import { TonalDialog } from './dialogs/TonalDialog';
import { PreferencesDialog } from './dialogs/PreferencesDialog';
import { ExportDialog, ExportPreviewDialog, PsdExportDialog } from './dialogs/ExportDialog';
import { ColorSettingsDialog } from './dialogs/ColorSettingsDialog';
import { AnimationCelsExportDialog, AnimationExportDialog, AssignMultipleDialog, AudioExportDialog, CameraFolderDialog, CenterCanvasDialog, FrameRateDialog, ManageTimelinesDialog, MovieExportDialog, NewTimelineDialog, OnionSkinDialog, TimelineSettingsDialog } from './dialogs/AnimationDialogs';
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
        // Dialogs that preview on the canvas leave it undimmed; filters with a centre let the canvas take presses.
        <div className={`modal-backdrop ${backdropClass(dialog)}`} onPointerDown={(e) => e.target === e.currentTarget && closeDialog()}>
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
          {dialog.kind === 'custom' && dialog.id === 'colorSettings' && <ColorSettingsDialog />}
          {dialog.kind === 'custom' && dialog.id === 'exportPreview' && <ExportPreviewDialog />}
          {dialog.kind === 'custom' && dialog.id === 'exportPsd' && <PsdExportDialog />}
          {dialog.kind === 'custom' && dialog.id === 'timelineSettings' && <TimelineSettingsDialog />}
          {dialog.kind === 'custom' && dialog.id === 'onionSkin' && <OnionSkinDialog />}
          {dialog.kind === 'custom' && dialog.id === 'cameraFolder' && <CameraFolderDialog />}
          {dialog.kind === 'custom' && dialog.id === 'centerCanvas' && <CenterCanvasDialog />}
          {dialog.kind === 'custom' && dialog.id === 'assignMultiple' && <AssignMultipleDialog />}
          {dialog.kind === 'custom' && dialog.id === 'newTimeline' && <NewTimelineDialog />}
          {dialog.kind === 'custom' && dialog.id === 'frameRate' && <FrameRateDialog />}
          {dialog.kind === 'custom' && dialog.id === 'manageTimelines' && <ManageTimelinesDialog />}
          {dialog.kind === 'custom' && dialog.id === 'exportGif' && <AnimationExportDialog format="gif" />}
          {dialog.kind === 'custom' && dialog.id === 'exportApng' && <AnimationExportDialog format="apng" />}
          {dialog.kind === 'custom' && dialog.id === 'exportWebp' && <AnimationExportDialog format="webp" />}
          {dialog.kind === 'custom' && dialog.id === 'exportSequence' && <AnimationExportDialog format="sequence" />}
          {dialog.kind === 'custom' && dialog.id === 'exportCels' && <AnimationCelsExportDialog />}
          {dialog.kind === 'custom' && dialog.id === 'exportAudio' && <AudioExportDialog />}
          {dialog.kind === 'custom' && dialog.id === 'exportMovie' && <MovieExportDialog />}
          {dialog.kind === 'custom' && dialog.id === 'about' && <AboutDialog />}
          {dialog.kind === 'custom' && dialog.id === 'shortcuts' && <ShortcutsDialog />}
          {dialog.kind === 'tonal' && <TonalDialog target={dialog.target} />}
          {dialog.kind === 'custom' && dialog.id === 'pressure' && <PressureDialog />}
          {dialog.kind === 'filter' && <FilterDialog key={dialog.filter} id={dialog.filter} />}
          {dialog.kind === 'custom' && dialog.id === 'preferences' && <PreferencesDialog />}
          {dialog.kind === 'custom' && dialog.id === 'canvasSize' && <CanvasSizeDialog mode="canvas" />}
          {dialog.kind === 'custom' && dialog.id === 'imageResolution' && <CanvasSizeDialog mode="resolution" />}
          {dialog.kind === 'custom' && dialog.id === 'newFrameFolder' && <NewFrameFolderDialog />}
          {dialog.kind === 'custom' && dialog.id === 'divideFrame' && <DivideFrameDialog />}
          {dialog.kind === 'custom' && dialog.id === 'frameTemplates' && <FrameTemplateDialog />}
          {dialog.kind === 'custom' && dialog.id === 'drawAlongRuler' && <DrawAlongRulerDialog />}
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

function backdropClass(dialog: NonNullable<ReturnType<typeof useOverlays.getState>['dialog']>): string {
  if (dialog.kind === 'filter') return filterSpec(dialog.filter).center ? 'clear top pass' : 'clear top';
  if (dialog.kind === 'tonal' || (dialog.kind === 'custom' && dialog.id === 'centerCanvas')) return 'clear';
  return '';
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
