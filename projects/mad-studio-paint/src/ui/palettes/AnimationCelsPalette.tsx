/**
 * Animation cels palette: the target cel, its cel-specific light table and the general light table.
 * Property bar: reset position, reverse horizontally / vertically, opacity (of the selected layer or,
 * switched, of all), colour mode and display colour. Command bar: enable light table, lock the target
 * cel, previous / next cel, new animation cel, register a file or the selected layer, deregister,
 * Light table tool, show the cel-specific / general light table. Image files dropped on the palette
 * are registered.
 */
import { useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { findLayer } from '../../model/layers';
import type { OnionMode } from '../../paint/animation';
import type { LightLayer } from '../../paint/lightTable';
import * as actions from '../../store/actions';
import * as anim from '../../store/animationActions';
import * as light from '../../store/lightTableActions';
import { useStore } from '../../store/store';
import { Icon } from '../controls/Icons';
import { PropSlider } from '../controls/PropSlider';
import { LayerThumb } from './LayerThumb';

function Button({ icon, label, onClick, on, disabled }: { icon: string; label: string; onClick: () => void; on?: boolean; disabled?: boolean }) {
  return (
    <button className={`icon-btn ${on ? 'on' : ''}`} title={label} aria-label={label} aria-pressed={on === undefined ? undefined : on} disabled={disabled} onClick={onClick}>
      <Icon name={icon} size={16} />
    </button>
  );
}

const MODES: [OnionMode, string][] = [
  ['color', 'Color'],
  ['half', 'Half color'],
  ['mono', 'Monochrome'],
];

function LightRow({ l, selected }: { l: LightLayer; selected: boolean }) {
  const name = useStore((s) => (l.source.kind === 'image' ? l.source.name : (findLayer(s.doc.layers, l.source.layer)?.name ?? null)));
  if (name === null) return null;
  return (
    <button className={`cels-row ${selected ? 'selected' : ''}`} data-testid="light-layer" aria-pressed={selected} onClick={() => light.selectLight(l.id)}>
      {l.source.kind === 'layer' ? <LayerThumb id={l.source.layer} /> : <LayerThumb id={l.source.image} />}
      <span className="cels-name">{name}</span>
      <span className="cels-meta">
        {Math.round(l.opacity * 100)} %{l.mode !== 'color' && <span className="cels-swatch" style={{ background: l.color }} />}
      </span>
    </button>
  );
}

export function AnimationCelsPalette() {
  const doc = useStore((s) => s.doc);
  const { lightOn, lightShowCel, lightShowGeneral, lightSelection, lockedCel, lightOpacityAll, tool } = useStore(
    useShallow((s) => ({
      lightOn: s.lightOn,
      lightShowCel: s.lightShowCel,
      lightShowGeneral: s.lightShowGeneral,
      lightSelection: s.lightSelection,
      lockedCel: s.lockedCel,
      lightOpacityAll: s.lightOpacityAll,
      tool: s.tool,
    })),
  );
  const { folder, cel } = useStore(
    useShallow((s) => {
      const t = light.targetCel(s);
      return { folder: t?.folder ?? null, cel: t?.cel ?? null };
    }),
  );
  const target = folder && cel ? { folder, cel } : null;
  const file = useRef<HTMLInputElement>(null);
  const celList = target?.cel.lightTable ?? [];
  const general = doc.lightTable?.general ?? [];
  const selected = [...celList, ...general].find((l) => l.id === lightSelection) ?? null;
  const shownOpacity = selected?.opacity ?? celList[0]?.opacity ?? general[0]?.opacity ?? 0.5;
  const lightTool = tool === 'lightTable';

  const registerFiles = async (files: File[]) => {
    for (const f of files) if (f.type.startsWith('image/')) await light.registerFile(f, f.name);
  };

  return (
    <div
      className="cels-palette"
      data-testid="animation-cels"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault();
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        e.stopPropagation();
        void registerFiles([...e.dataTransfer.files]);
      }}
    >
      <div className="cels-bar">
        <Button icon="resetRotation" label="Reset position of layers on light table" onClick={light.resetLightPosition} />
        <Button icon="flipH" label="Reverse layers horizontally on light table" disabled={!selected} onClick={() => light.flipLight('h')} />
        <Button icon="flipV" label="Reverse layers vertically on light table" disabled={!selected} onClick={() => light.flipLight('v')} />
        <Button icon="opacityAll" label="Switch opacity target between All or Individual" on={lightOpacityAll} onClick={light.toggleLightOpacityAll} />
        <select className="cels-mode" aria-label="Color mode" value={selected?.mode ?? 'color'} disabled={!selected} onChange={(e) => light.setLightMode(e.target.value as OnionMode)}>
          {MODES.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
        <input type="color" className="cels-color" aria-label="Light table layer color" value={selected?.color ?? '#2f6bff'} disabled={!selected || selected.mode === 'color'} onChange={(e) => light.setLightColor(e.target.value)} />
      </div>
      <PropSlider label="Light table opacity" unit="%" value={Math.round(shownOpacity * 100)} min={0} max={100} onChange={(v) => light.setLightOpacity(v / 100)} />
      <div className="cels-bar">
        <Button icon="lightTable" label="Enable light table" on={lightOn} onClick={light.toggleLightTable} />
        <Button icon="lock" label="Lock current animation cel as editing target" on={lockedCel !== null} onClick={light.toggleCelLock} />
        <Button icon="framePrev" label="Select previous cel" onClick={() => light.selectNeighbourCel(-1)} />
        <Button icon="frameNext" label="Select next cel" onClick={() => light.selectNeighbourCel(1)} />
        <Button icon="newCel" label="New animation cel" onClick={() => void anim.newAnimationCel()} />
        <Button icon="open" label="Select and register file" onClick={() => file.current?.click()} />
        <Button icon="registerLayer" label="Register selected layer" onClick={light.registerSelectedLayer} />
        <Button
          icon="trash"
          label={selected ? 'Deregister selected image from light table' : 'Deregister all images from light table'}
          onClick={selected ? light.deregisterSelected : light.deregisterAll}
        />
        <Button icon="operation" label="Light table tool" on={lightTool} onClick={() => actions.setTool(lightTool ? 'object' : 'lightTable')} />
        <Button icon="celLight" label="Show cel-specific light table" on={lightShowCel} onClick={light.toggleShowCelLight} />
        <Button icon="generalLight" label="Show general light table" on={lightShowGeneral} onClick={light.toggleShowGeneralLight} />
        <input
          ref={file}
          type="file"
          accept="image/*"
          hidden
          data-testid="light-file"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = '';
            void registerFiles(files);
          }}
        />
      </div>
      <div className="cels-section">
        <div className="cels-head">Target cel</div>
        {target ? (
          <div className="cels-row target" data-testid="target-cel">
            <LayerThumb id={target.cel.kind === 'folder' ? target.folder.id : target.cel.id} />
            <span className="cels-name">
              {target.folder.name} / {target.cel.name}
            </span>
            {lockedCel && <Icon name="lock" size={12} />}
          </div>
        ) : (
          <div className="cels-empty">Select a cel of an animation folder</div>
        )}
      </div>
      <div className={`cels-section ${lightShowCel ? '' : 'off'}`} data-testid="cel-light-table">
        <div className="cels-head">Cel-specific light table</div>
        {celList.map((l) => (
          <LightRow key={l.id} l={l} selected={l.id === lightSelection} />
        ))}
        {target && celList.length === 0 && <div className="cels-empty">Register a layer or an image for this cel</div>}
      </div>
      <div className={`cels-section ${lightShowGeneral ? '' : 'off'}`} data-testid="general-light-table">
        <div className="cels-head">General light table</div>
        {general.map((l) => (
          <LightRow key={l.id} l={l} selected={l.id === lightSelection} />
        ))}
        {general.length === 0 && <div className="cels-empty">Shown for every cel</div>}
      </div>
    </div>
  );
}
