import { useState } from 'react';
import { BLEND_MODES, FOLDER_BLEND_MODES } from '../../model/blend';
import { countLayers, findLayer, isEffectivelyLocked, layerBelow } from '../../model/layers';
import type { FolderBlendMode, Id, Layer } from '../../model/types';
import { isMac } from '../../platform/platform';
import * as actions from '../../store/actions';
import { getState, useStore } from '../../store/store';
import { Icon } from '../controls/Icons';
import { openTonalDialog, showMenu } from '../overlays';
import { LayerThumb } from './LayerThumb';

const blendLabel = (mode: FolderBlendMode) => FOLDER_BLEND_MODES.find((m) => m.id === mode)?.label ?? mode;

/** Blend mode + opacity of the selected layer (header of the layer palette). */
export function LayerPropertyBar() {
  const layer = useStore((s) => findLayer(s.doc.layers, s.activeLayerId));
  if (!layer) return null;
  if (layer.kind === 'audio') {
    // An audio layer: no blending; the bar sets its volume.
    return (
      <div className="layer-props" title="Audio layer: the bar sets its volume">
        <select className="blend-select" aria-label="Blending mode" value="normal" disabled>
          <option value="normal">Normal</option>
        </select>
        <OpacityBar value={Math.round(layer.volume * 100)} onChange={(v) => actions.setLayerProps(layer.id, { volume: v / 100 }, 'Volume', `volume:${layer.id}`)} />
      </div>
    );
  }
  const modes = layer.kind === 'folder' ? FOLDER_BLEND_MODES : BLEND_MODES;
  return (
    <div className="layer-props">
      <select
        className="blend-select"
        aria-label="Blending mode"
        value={layer.blend}
        onChange={(e) => actions.setLayerProps(layer.id, { blend: e.target.value as never }, 'Blending mode')}
      >
        {modes.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
      <OpacityBar value={Math.round(layer.opacity * 100)} onChange={(v) => actions.setLayerProps(layer.id, { opacity: v / 100 }, 'Layer opacity')} />
    </div>
  );
}

/** Opacity bar with a transparency → white track and a numeric field. */
function OpacityBar({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const drag = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    const set = (ev: { clientX: number }) => {
      const r = el.getBoundingClientRect();
      onChange(Math.round(Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)) * 100));
    };
    set(e);
    const move = (ev: PointerEvent) => set(ev);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <div className="opacity-bar" data-testid="layer-opacity">
      <div className="opacity-track" onPointerDown={drag}>
        <div className="opacity-handle" style={{ left: `${value}%` }} />
      </div>
      <input
        type="number"
        aria-label="Layer opacity"
        min={0}
        max={100}
        value={value}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(Math.min(100, Math.max(0, Math.round(v))));
        }}
        onKeyDown={(e) => e.stopPropagation()}
      />
    </div>
  );
}

/** Toggles for the selected layer: clipping, reference, draft, lock, lock transparent pixels. */
export function LayerFlagBar() {
  const layer = useStore((s) => findLayer(s.doc.layers, s.activeLayerId));
  if (!layer) return null;
  const toggle = (key: 'clip' | 'reference' | 'draft' | 'locked', label: string) => actions.setLayerProps(layer.id, { [key]: !layer[key] }, label);
  return (
    <div className="layer-flags">
      <span className="spacer" />
      <FlagButton icon="clip" label="Clip to layer below" on={layer.clip} onClick={() => toggle('clip', 'Clip to layer below')} />
      <FlagButton icon="reference" label="Set as reference layer" on={layer.reference} onClick={() => toggle('reference', 'Reference layer')} />
      <FlagButton icon="draft" label="Set as draft layer" on={layer.draft} onClick={() => toggle('draft', 'Draft layer')} />
      <FlagButton icon="lock" label="Lock layer" on={layer.locked} onClick={() => toggle('locked', 'Lock layer')} />
      <FlagButton
        icon="lockAlpha"
        label="Lock transparent pixels"
        on={layer.kind === 'raster' && layer.lockAlpha}
        disabled={layer.kind !== 'raster'}
        onClick={() => layer.kind === 'raster' && actions.setLayerProps(layer.id, { lockAlpha: !layer.lockAlpha }, 'Lock transparent pixels')}
      />
    </div>
  );
}

function FlagButton({ icon, label, on, onClick, disabled }: { icon: string; label: string; on: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button className={`icon-btn flag ${on ? 'on' : ''}`} title={label} aria-label={label} aria-pressed={on} disabled={disabled} onClick={onClick}>
      <Icon name={icon} size={16} />
    </button>
  );
}

export function LayerActionBar() {
  const canMerge = useStore((s) => actions.canMergeDown(s));
  const count = useStore((s) => countLayers(s.doc.layers));
  const mod = isMac ? '⌘' : 'Ctrl+';
  return (
    <div className="layer-actions">
      <span className="spacer" />
      <button className="icon-btn" title={`New raster layer (${isMac ? '⇧⌘N' : 'Shift+Ctrl+N'})`} aria-label="New raster layer" onClick={() => actions.addRasterLayer()}>
        <Icon name="newLayer" />
      </button>
      <button className="icon-btn" title="New vector layer" aria-label="New vector layer" onClick={() => actions.addVectorLayer()}>
        <Icon name="newVector" />
      </button>
      <button className="icon-btn" title="New layer folder" aria-label="New layer folder" onClick={() => actions.addFolder()}>
        <Icon name="newFolder" />
      </button>
      <button className="icon-btn" title="Transfer to lower layer" aria-label="Transfer to lower layer" disabled={!canMerge} onClick={() => actions.transferToLowerLayer()}>
        <Icon name="transferDown" />
      </button>
      <button className="icon-btn" title={`Merge with layer below (${mod}E)`} aria-label="Merge with layer below" disabled={!canMerge} onClick={() => actions.mergeDown()}>
        <Icon name="mergeDown" />
      </button>
      <button className="icon-btn" title="Mask outside selection" aria-label="Mask outside selection" onClick={() => actions.maskLayer(true)}>
        <Icon name="mask" />
      </button>
      <button className="icon-btn" title="Delete layer" aria-label="Delete layer" disabled={count <= 1} onClick={() => actions.deleteLayer()}>
        <Icon name="trash" />
      </button>
    </div>
  );
}

type DropPos = 'above' | 'below' | 'inside';

export function LayerList() {
  const layers = useStore((s) => s.doc.layers);
  const [drag, setDrag] = useState<Id | null>(null);
  const [drop, setDrop] = useState<{ id: Id; pos: DropPos } | null>(null);
  return (
    <div className="layer-list" role="list" data-testid="layer-list" onDragEnd={() => (setDrag(null), setDrop(null))}>
      <LayerRows layers={layers} depth={0} drag={drag} setDrag={setDrag} drop={drop} setDrop={setDrop} />
      <PaperRow />
    </div>
  );
}

interface RowsProps {
  layers: Layer[];
  depth: number;
  drag: Id | null;
  setDrag: (id: Id | null) => void;
  drop: { id: Id; pos: DropPos } | null;
  setDrop: (d: { id: Id; pos: DropPos } | null) => void;
}

function LayerRows(props: RowsProps) {
  return (
    <>
      {props.layers.map((layer) => (
        <div key={layer.id} role="listitem">
          <LayerRow layer={layer} {...props} />
          {layer.kind === 'folder' && layer.expanded && <LayerRows {...props} layers={layer.children} depth={props.depth + 1} />}
        </div>
      ))}
    </>
  );
}

function LayerRow({ layer, depth, drag, setDrag, drop, setDrop }: RowsProps & { layer: Layer }) {
  const active = useStore((s) => s.activeLayerId === layer.id);
  const lockedByParent = useStore((s) => !layer.locked && isEffectivelyLocked(s.doc.layers, layer.id));
  const hasBase = useStore((s) => layer.clip && layerBelow(s.doc.layers, layer.id) !== null);
  const maskTarget = useStore((s) => s.activeLayerId === layer.id && s.maskEditing && Boolean(layer.mask));
  const [editing, setEditing] = useState(false);

  const onDragOver = (e: React.DragEvent) => {
    if (!drag || drag === layer.id) return;
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const t = (e.clientY - r.top) / r.height;
    const pos: DropPos = layer.kind === 'folder' && t > 0.3 && t < 0.7 ? 'inside' : t < 0.5 ? 'above' : 'below';
    if (drop?.id !== layer.id || drop.pos !== pos) setDrop({ id: layer.id, pos });
  };

  const menu = (e: React.MouseEvent) => {
    e.preventDefault();
    actions.selectLayer(layer.id);
    showMenu({ x: e.clientX, y: e.clientY }, [
      { label: 'New raster layer', onClick: () => actions.addRasterLayer() },
      { label: 'New vector layer', onClick: () => actions.addVectorLayer() },
      { label: 'New layer folder', onClick: () => actions.addFolder() },
      { label: 'Create folder and insert layer', onClick: () => actions.groupLayer(layer.id) },
      { separator: true },
      { label: 'Duplicate layer', onClick: () => actions.duplicateLayer(layer.id) },
      { label: 'Delete layer', onClick: () => actions.deleteLayer(layer.id) },
      { label: 'Merge with layer below', disabled: !actions.canMergeDown(), onClick: () => actions.mergeDown() },
      { separator: true },
      { label: 'Rename…', onClick: () => setEditing(true) },
      ...(layer.kind === 'correction' && layer.correction.type !== 'reverse'
        ? [{ label: 'Correction layer settings…', onClick: () => openTonalDialog({ kind: 'layer', layerId: layer.id }) }]
        : []),
      ...(layer.kind === 'raster' || actions.isRenderedLayer(layer) ? [{ label: 'Select layer opacity area', onClick: () => actions.selectLayerOpacity(layer.id) }] : []),
      ...(actions.isRenderedLayer(layer) ? [{ label: 'Rasterize', disabled: layer.locked, onClick: () => actions.rasterizeLayer(layer.id) }] : []),
      { separator: true },
      { label: 'Clip to layer below', checked: layer.clip, onClick: () => actions.setLayerProps(layer.id, { clip: !layer.clip }, 'Clip to layer below') },
      { label: 'Set as reference layer', checked: layer.reference, onClick: () => actions.setLayerProps(layer.id, { reference: !layer.reference }, 'Reference layer') },
      { label: 'Set as draft layer', checked: layer.draft, onClick: () => actions.setLayerProps(layer.id, { draft: !layer.draft }, 'Draft layer') },
      { label: 'Lock layer', checked: layer.locked, onClick: () => actions.setLayerProps(layer.id, { locked: !layer.locked }, 'Lock layer') },
    ]);
  };

  const maskMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const mask = layer.mask;
    if (!mask) return;
    actions.selectLayer(layer.id, true);
    showMenu({ x: e.clientX, y: e.clientY }, [
      { label: 'Delete mask', onClick: () => actions.deleteMask(layer.id) },
      { label: 'Apply mask to layer', onClick: () => actions.applyMaskToLayer(layer.id) },
      { separator: true },
      { label: 'Enable mask', checked: mask.enabled, onClick: () => actions.toggleMaskEnabled(layer.id) },
      { label: 'Link mask to layer', checked: mask.linked, onClick: () => actions.toggleMaskLink(layer.id) },
      { label: 'Show mask area', checked: getState().showMaskArea, onClick: () => actions.toggleShowMaskArea() },
      { separator: true },
      { label: 'Select mask area', onClick: () => actions.selectMaskArea(layer.id) },
    ]);
  };

  /** Clicking a thumbnail picks the drawing target: the layer's pixels or its mask. */
  const pickTarget = (mask: boolean) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (isMac ? e.metaKey : e.ctrlKey) {
      const op = e.shiftKey ? 'add' : e.altKey ? 'subtract' : 'replace';
      if (mask) actions.selectMaskArea(layer.id, op);
      else if (layer.kind === 'raster') actions.selectLayerOpacity(layer.id, op);
      return;
    }
    actions.selectLayer(layer.id, mask);
  };

  const dropClass = drop?.id === layer.id ? `drop-${drop.pos}` : '';
  return (
    <div
      className={`layer-row ${active ? 'active' : ''} ${layer.visible ? '' : 'hidden'} ${drag === layer.id ? 'dragging' : ''} ${dropClass}`}
      style={{ paddingLeft: 4 + depth * 14 }}
      data-layer-id={layer.id}
      data-testid="layer-row"
      draggable={!editing}
      onDragStart={(e) => {
        setDrag(layer.id);
        e.dataTransfer.effectAllowed = 'copyMove';
        e.dataTransfer.setData('text/plain', layer.id);
      }}
      onDragOver={onDragOver}
      onDragLeave={() => drop?.id === layer.id && setDrop(null)}
      onDrop={(e) => {
        e.preventDefault();
        // ⌥-drag duplicates the layer instead of moving it.
        if (drag && drop) (e.altKey ? actions.duplicateLayerTo : actions.moveLayer)(drag, drop.id, drop.pos);
        setDrag(null);
        setDrop(null);
      }}
      onPointerDown={(e) => {
        // Clicking the row keeps the mask as the target when it already is.
        const s = getState();
        if (e.button === 0) actions.selectLayer(layer.id, s.activeLayerId === layer.id && s.maskEditing);
      }}
      onContextMenu={menu}
    >
      <button
        className={`eye ${layer.visible ? 'on' : ''}`}
        title={layer.visible ? 'Hide layer' : 'Show layer'}
        aria-label={layer.visible ? 'Hide layer' : 'Show layer'}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => (e.altKey ? actions.soloLayer(layer.id) : actions.setLayerProps(layer.id, { visible: !layer.visible }, layer.visible ? 'Hide layer' : 'Show layer'))}
      >
        {layer.visible && <Icon name="eye" size={15} />}
      </button>
      <span className="row-state" title={active ? 'Editing target' : layer.reference ? 'Reference layer' : ''}>
        {active ? <Icon name="pen" size={13} /> : layer.reference ? <Icon name="reference" size={13} /> : null}
      </span>
      <span className="row-bars">
        {layer.clip && <span className={`clip-bar ${hasBase ? '' : 'orphan'}`} title="Clipped to the layer below" />}
        {layer.draft && <span className="draft-bar" title="Draft layer" />}
      </span>
      {layer.kind === 'folder' ? (
        <>
          <button
            className="twisty"
            aria-label={layer.expanded ? 'Collapse folder' : 'Expand folder'}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => actions.setLayerProps(layer.id, { expanded: !layer.expanded }, 'Expand folder', `expand:${layer.id}`)}
          >
            <Icon name={layer.expanded ? 'chevronDown' : 'chevronRight'} size={12} />
          </button>
          <span
            className={`folder-icon ${active && layer.mask && !maskTarget ? 'target' : ''}`}
            onPointerDown={pickTarget(false)}
            title={layer.frame ? 'Frame border folder' : layer.animation ? 'Animation folder' : layer.camera ? '2D camera folder' : undefined}
            data-testid={layer.frame ? 'frame-icon' : layer.animation ? 'animation-icon' : layer.camera ? 'camera-icon' : undefined}
          >
            <Icon name={layer.frame ? 'frame' : layer.animation ? 'animFolder' : layer.camera ? 'camera' : 'folder'} size={22} />
          </span>
        </>
      ) : layer.kind === 'audio' ? (
        <span className="correction-icon audio-icon" title="Audio layer: its clips play sound in the timeline; hidden, it is muted" data-testid="audio-icon" onPointerDown={pickTarget(false)}>
          <Icon name="audio" size={22} />
        </span>
      ) : layer.kind === 'correction' ? (
        <span
          className={`correction-icon ${active && layer.mask && !maskTarget ? 'target' : ''}`}
          title={layer.correction.type === 'reverse' ? 'Correction layer' : 'Correction layer: click to change the settings'}
          data-testid="correction-icon"
          onPointerDown={pickTarget(false)}
          onClick={() => layer.correction.type !== 'reverse' && openTonalDialog({ kind: 'layer', layerId: layer.id })}
        >
          <Icon name="correction" size={22} />
        </span>
      ) : (
        <span
          className={`thumb-wrap ${active && layer.mask && !maskTarget ? 'target' : ''}`}
          title={`${isMac ? '⌘' : 'Ctrl'}-click: select layer opacity area`}
          onPointerDown={pickTarget(false)}
        >
          <LayerThumb id={layer.id} />
        </span>
      )}
      {layer.mask && (
        <>
          <button
            className={`mask-link ${layer.mask.linked ? 'on' : ''}`}
            title="Link mask to layer"
            aria-label="Link mask to layer"
            aria-pressed={layer.mask.linked}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => actions.toggleMaskLink(layer.id)}
          >
            {layer.mask.linked && <Icon name="check" size={11} />}
          </button>
          <span
            className={`thumb-wrap mask-thumb ${maskTarget ? 'target' : ''} ${layer.mask.enabled ? '' : 'disabled'}`}
            title={`Layer mask${layer.mask.enabled ? '' : ' (disabled)'} · ${isMac ? '⌘' : 'Ctrl'}-click: select mask area`}
            data-testid="mask-thumb"
            onPointerDown={pickTarget(true)}
            onContextMenu={maskMenu}
          >
            <LayerThumb id={layer.mask.id} mask />
          </span>
        </>
      )}
      <span className="layer-text" onDoubleClick={() => setEditing(true)}>
        <span className="layer-meta">{layer.kind === 'audio' ? `Volume ${Math.round(layer.volume * 100)} %` : `${Math.round(layer.opacity * 100)} % ${blendLabel(layer.blend)}`}</span>
        {editing ? (
          <input
            className="rename"
            ref={(el) => {
              // Focus and select the whole name in the same commit as the double click: deferring it
              // lets keys typed right away reach the tool shortcuts instead of the field.
              if (el && !el.dataset.ready) {
                el.dataset.ready = '1';
                el.focus();
                el.select();
              }
            }}
            defaultValue={layer.name}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') setEditing(false);
            }}
            onBlur={(e) => {
              actions.renameLayer(layer.id, e.target.value);
              setEditing(false);
            }}
          />
        ) : (
          <span className="layer-name">{layer.name}</span>
        )}
      </span>
      <span className="row-icons">
        {layer.kind === 'vector' && (
          <span className="vector-icon" title="Vector layer" data-testid="vector-icon">
            <Icon name="vector" size={16} />
          </span>
        )}
        {layer.kind === 'gradient' && (
          <span className="vector-icon" title="Gradient layer" data-testid="gradient-icon">
            <Icon name="gradient" size={16} />
          </span>
        )}
        {layer.kind === 'text' && (
          <span className="vector-icon" title={layer.balloons.length ? 'Balloon layer' : 'Text layer'} data-testid={layer.balloons.length ? 'balloon-icon' : 'text-icon'}>
            <Icon name={layer.balloons.length ? 'balloon' : 'text'} size={16} />
          </span>
        )}
        {layer.rulers && (
          <button
            className={`ruler-icon ${layer.rulers.visible ? '' : 'off'}`}
            title="Ruler: where it applies (⇧-click shows or hides it)"
            aria-label="Ruler range"
            data-testid="ruler-icon"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              if (e.shiftKey) {
                actions.toggleRulersVisible(layer.id);
                return;
              }
              const range = layer.rulers?.range;
              showMenu({ x: e.clientX, y: e.clientY }, [
                { label: 'Show in all layers', checked: range === 'all', onClick: () => actions.setRulerRange(layer.id, 'all') },
                { label: 'Show in same folder', checked: range === 'folder', onClick: () => actions.setRulerRange(layer.id, 'folder') },
                { label: 'Show only when editing target', checked: range === 'editing', onClick: () => actions.setRulerRange(layer.id, 'editing') },
                { separator: true },
                { label: 'Show ruler', checked: layer.rulers?.visible, onClick: () => actions.toggleRulersVisible(layer.id) },
                { label: 'Delete ruler', onClick: () => actions.deleteLayerRulers(layer.id) },
              ]);
            }}
          >
            <Icon name="ruler" size={13} />
          </button>
        )}
        {layer.draft && <Icon name="draft" size={12} />}
        {layer.kind === 'raster' && layer.lockAlpha && <Icon name="lockAlpha" size={12} />}
        {(layer.locked || lockedByParent) && <Icon name="lock" size={12} />}
      </span>
    </div>
  );
}

/** The paper (background colour) of the canvas, shown below all layers. */
function PaperRow() {
  const paper = useStore((s) => s.doc.paper);
  return (
    <div className={`layer-row paper ${paper.visible ? '' : 'hidden'}`} data-testid="paper-row">
      <button
        className={`eye ${paper.visible ? 'on' : ''}`}
        aria-label={paper.visible ? 'Hide paper' : 'Show paper'}
        title={paper.visible ? 'Hide paper' : 'Show paper'}
        onClick={() => actions.setPaper({ visible: !paper.visible })}
      >
        {paper.visible && <Icon name="eye" size={15} />}
      </button>
      <span className="row-state" />
      <span className="row-bars" />
      <label className="paper-swatch" style={{ background: paper.color }} title="Paper color (click to change)">
        <input type="color" value={paper.color} onChange={(e) => actions.setPaper({ color: e.target.value })} aria-label="Paper color" />
      </label>
      <span className="paper-icon">
        <Icon name="page" size={16} />
      </span>
      <span className="layer-text">
        <span className="layer-name">Paper</span>
      </span>
    </div>
  );
}
