import { RegisterMaterialDialog } from './dialogs/MaterialDialogs';
import { QuickAccessSettingsDialog } from './dialogs/QuickAccessSettingsDialog';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CanvasSizeDialog } from './dialogs/AdjustDialogs';
import { FilterDialog } from './dialogs/FilterDialog';
import { GridSettingsDialog } from './dialogs/GridSettingsDialog';
import { ColorSetsDialog } from './palettes/ColorSet';
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
import { FrameEditDialog, GoToFrameDialog, GoToLabelDialog, TimelineLabelDialog, TrackLabelDialog } from './dialogs/LabelDialogs';
import { BlurBorderDialog, ColorGamutDialog, GrowSelectionDialog } from './dialogs/SelectionDialogs';
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
          {dialog.kind === 'custom' && dialog.id === 'timelineLabel' && <TimelineLabelDialog />}
          {dialog.kind === 'custom' && dialog.id === 'trackLabel' && <TrackLabelDialog />}
          {dialog.kind === 'custom' && dialog.id === 'goToFrame' && <GoToFrameDialog />}
          {dialog.kind === 'custom' && dialog.id === 'goToLabel' && <GoToLabelDialog />}
          {dialog.kind === 'custom' && dialog.id === 'insertFrame' && <FrameEditDialog mode="insert" />}
          {dialog.kind === 'custom' && dialog.id === 'deleteFrame' && <FrameEditDialog mode="delete" />}
          {dialog.kind === 'custom' && dialog.id === 'expandSelection' && <GrowSelectionDialog mode="expand" />}
          {dialog.kind === 'custom' && dialog.id === 'shrinkSelection' && <GrowSelectionDialog mode="shrink" />}
          {dialog.kind === 'custom' && dialog.id === 'blurBorder' && <BlurBorderDialog />}
          {dialog.kind === 'custom' && dialog.id === 'colorGamut' && <ColorGamutDialog />}
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
          {dialog.kind === 'custom' && dialog.id === 'gridSettings' && <GridSettingsDialog />}
          {dialog.kind === 'custom' && dialog.id === 'colorSets' && <ColorSetsDialog />}
          {dialog.kind === 'custom' && dialog.id === 'canvasSize' && <CanvasSizeDialog mode="canvas" />}
          {dialog.kind === 'custom' && dialog.id === 'imageResolution' && <CanvasSizeDialog mode="resolution" />}
          {dialog.kind === 'custom' && dialog.id === 'newFrameFolder' && <NewFrameFolderDialog />}
          {dialog.kind === 'custom' && dialog.id === 'divideFrame' && <DivideFrameDialog />}
          {dialog.kind === 'custom' && dialog.id === 'frameTemplates' && <FrameTemplateDialog />}
          {dialog.kind === 'custom' && dialog.id === 'drawAlongRuler' && <DrawAlongRulerDialog />}
          {dialog.kind === 'custom' && dialog.id === 'newTone' && <NewToneDialog />}
          {dialog.kind === 'custom' && dialog.id === 'gradient' && <GradientDialog />}
          {dialog.kind === 'custom' && dialog.id === 'registerMaterial' && <RegisterMaterialDialog />}
          {dialog.kind === 'custom' && dialog.id === 'quickAccessSettings' && <QuickAccessSettingsDialog />}
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
  // Select color gamut: clicks on the canvas pick colours while it is open.
  if (dialog.kind === 'custom' && dialog.id === 'colorGamut') return 'clear top pass';
  // Quick Access Settings: the palette (and the rest of the window) stays usable.
  if (dialog.kind === 'custom' && dialog.id === 'quickAccessSettings') return 'clear pass';
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
  const [pos, setPos] = useState({ x, y, flip: false });
  useLayoutEffect(() => {
    const r = ref.current!.getBoundingClientRect();
    const left = Math.min(x, window.innerWidth - r.width - 4);
    // Submenus open to the left when there is no room on the right.
    setPos({ x: left, y: Math.min(y, window.innerHeight - r.height - 4), flip: left + r.width * 2 > window.innerWidth });
  }, [x, y]);
  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) closeMenu();
    };
    window.addEventListener('pointerdown', close, true);
    return () => window.removeEventListener('pointerdown', close, true);
  }, []);
  return (
    <div className={`context-menu ${pos.flip ? 'flip' : ''}`} ref={ref} style={{ left: pos.x, top: pos.y }} role="menu">
      <ContextItems items={items} />
    </div>
  );
}

/** The items of a context menu; a submenu opens to the side while its item is hovered (or clicked). */
function ContextItems({ items }: { items: MenuItem[] }) {
  return (
    <>
      {items.map((it, i) =>
        it.separator ? (
          <div key={i} className="menu-sep" />
        ) : it.submenu ? (
          <SubMenu key={i} item={it} />
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
    </>
  );
}

/** A submenu: kept inside the window (moved up when it would reach past the bottom). */
function SubMenu({ item }: { item: MenuItem }) {
  const [open, setOpen] = useState(false);
  const [lift, setLift] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    // Where it would be without the lift.
    const top = r.top + lift;
    const over = r.bottom + lift - (window.innerHeight - 4);
    setLift(over > 0 ? Math.max(0, Math.min(over, top - 4)) : 0);
  }, [open]);
  return (
    <div className={`menu-sub ${open ? 'open' : ''} ${item.disabled ? 'disabled' : ''}`} onPointerEnter={() => !item.disabled && setOpen(true)} onPointerLeave={() => setOpen(false)}>
      <button role="menuitem" className="menu-item" aria-haspopup="menu" aria-expanded={open} disabled={item.disabled} onClick={() => setOpen((o) => !o)}>
        <span className="menu-check" />
        <span className="menu-label">{item.label}</span>
        <span className="menu-shortcut">▸</span>
      </button>
      {open && !item.disabled && (
        <div ref={ref} className="menu-dropdown sub" style={{ display: 'flex', top: -4 - lift }} role="menu" aria-label={item.label}>
          <ContextItems items={item.submenu!} />
        </div>
      )}
    </div>
  );
}
