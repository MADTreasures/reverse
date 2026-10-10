/**
 * Search Layer palette, like the reference's: the canvas's layers filtered by layer type (the
 * list at the top left), by conditions they must have (Include, the eye) or must not have
 * (Exclude), and by search keywords in their name. Click a layer to edit it, the eye shows or
 * hides it, the trash deletes the selected one; with one type chosen, a button makes a new layer
 * of that type.
 */
import { useMemo } from 'react';
import { create } from 'zustand';
import { FOLDER_BLEND_MODES } from '../../model/blend';
import { ALL_TYPES, EXCLUDE_CONDITIONS, INCLUDE_CONDITIONS, LAYER_TYPES, NO_SEARCH, searchLayers, type LayerCondition, type LayerSearch, type LayerType } from '../../model/layerSearch';
import type { Layer } from '../../model/types';
import * as actions from '../../store/actions';
import { useStore } from '../../store/store';
import { Icon } from '../controls/Icons';
import { showMenu, type MenuItem } from '../overlays';
import { LayerThumb } from './LayerThumb';

/** The search stays while other palettes are in front. */
const useSearch = create<LayerSearch>(() => NO_SEARCH);
const setSearch = (patch: Partial<LayerSearch>) => useSearch.setState(patch);

const typeName = (t: LayerType) => LAYER_TYPES.find(([id]) => id === t)?.[1] ?? t;

/** New layers for the types that have a command for it. */
const NEW_LAYER: Partial<Record<LayerType, [string, () => void]>> = {
  raster: ['New raster layer', () => void actions.addRasterLayer()],
  vector: ['New vector layer', () => void actions.addVectorLayer()],
  folder: ['New layer folder', () => void actions.addFolder()],
};

/** Choosing a type while all are shown shows only that one; afterwards each click adds or takes out a type. */
function typesMenu(q: LayerSearch): MenuItem[] {
  const all = ALL_TYPES.every((t) => q.types.includes(t));
  return [
    { label: 'All layers', checked: all, onClick: () => setSearch({ types: ALL_TYPES }) },
    { separator: true },
    ...LAYER_TYPES.map(([t, name]) => ({
      label: name,
      checked: !all && q.types.includes(t),
      onClick: () => {
        const next = all ? [t] : q.types.includes(t) ? q.types.filter((x) => x !== t) : [...q.types, t];
        setSearch({ types: next.length ? next : ALL_TYPES });
      },
    })),
  ];
}

function conditionsMenu(list: [LayerCondition, string][], chosen: LayerCondition[], key: 'include' | 'exclude'): MenuItem[] {
  return list.map(([c, name]) => ({ label: name, checked: chosen.includes(c), onClick: () => setSearch({ [key]: chosen.includes(c) ? chosen.filter((x) => x !== c) : [...chosen, c] }) }));
}

const menuAt = (e: React.MouseEvent<HTMLElement>, items: MenuItem[]) => {
  const b = e.currentTarget.getBoundingClientRect();
  showMenu({ x: b.left, y: b.bottom + 2 }, items);
};

function iconOf(l: Layer): string | null {
  if (l.kind === 'folder') return l.frame ? 'frame' : l.animation ? 'animFolder' : l.camera ? 'camera' : 'folder';
  if (l.kind === 'correction' || l.kind === 'audio' || l.kind === 'movie') return l.kind;
  return null;
}

function SearchRow({ layer, active }: { layer: Layer; active: boolean }) {
  const icon = iconOf(layer);
  const blend = FOLDER_BLEND_MODES.find((m) => m.id === ('blend' in layer ? layer.blend : 'normal'))?.label ?? '';
  return (
    <div
      className={`layer-row search-row ${active ? 'active' : ''} ${layer.visible ? '' : 'hidden'}`}
      data-testid="search-layer-row"
      data-layer-id={layer.id}
      role="listitem"
      onPointerDown={(e) => e.button === 0 && actions.selectLayer(layer.id)}
    >
      <button
        className={`eye ${layer.visible ? 'on' : ''}`}
        title={layer.visible ? 'Hide layer' : 'Show layer'}
        aria-label={layer.visible ? 'Hide layer' : 'Show layer'}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => actions.setLayerProps(layer.id, { visible: !layer.visible }, layer.visible ? 'Hide layer' : 'Show layer')}
      >
        {layer.visible && <Icon name="eye" size={15} />}
      </button>
      <span className="row-state">{active && <Icon name="pen" size={13} />}</span>
      {icon ? (
        <span className="correction-icon">
          <Icon name={icon} size={22} />
        </span>
      ) : (
        <span className="thumb-wrap">
          <LayerThumb id={layer.id} />
        </span>
      )}
      {layer.mask && (
        <span className="thumb-wrap mask-thumb">
          <LayerThumb id={layer.mask.id} mask />
        </span>
      )}
      <span className="layer-text">
        <span className="layer-meta">{layer.kind === 'audio' ? `Volume ${Math.round(layer.volume * 100)} %` : `${Math.round(layer.opacity * 100)} % ${blend}`}</span>
        <span className="layer-name">{layer.name}</span>
      </span>
    </div>
  );
}

export function SearchLayer() {
  const q = useSearch();
  const layers = useStore((s) => s.doc.layers);
  const active = useStore((s) => s.activeLayerId);
  const list = useMemo(() => searchLayers(layers, q, active), [layers, q, active]);
  const all = ALL_TYPES.every((t) => q.types.includes(t));
  const label = all ? 'All layers' : q.types.length === 1 ? typeName(q.types[0]) : `${q.types.length} layer types`;
  const create = !all && q.types.length === 1 ? NEW_LAYER[q.types[0]] : undefined;
  return (
    <div className="search-layer" data-testid="search-layer">
      <div className="search-bar">
        <button className="search-types" aria-label="Layer type" title="Layer types shown" onClick={(e) => menuAt(e, typesMenu(q))}>
          {label} ▾
        </button>
        <button className={`icon-btn ${q.include.length ? 'on' : ''}`} title="Include: only layers with these properties" aria-label="Include" onClick={(e) => menuAt(e, conditionsMenu(INCLUDE_CONDITIONS, q.include, 'include'))}>
          <Icon name="eye" size={15} />
        </button>
        <button className={`icon-btn ${q.exclude.length ? 'on' : ''}`} title="Exclude: no layers with these properties" aria-label="Exclude" onClick={(e) => menuAt(e, conditionsMenu(EXCLUDE_CONDITIONS, q.exclude, 'exclude'))}>
          <Icon name="close" size={15} />
        </button>
      </div>
      <div className="search-bar">
        <input className="search-text" type="search" placeholder="Type search keywords" aria-label="Search keywords" value={q.text} onChange={(e) => setSearch({ text: e.target.value })} />
        {create && (
          <button className="icon-btn" title={create[0]} aria-label={create[0]} onClick={create[1]}>
            <Icon name="newLayer" size={15} />
          </button>
        )}
        <button className="icon-btn" title="Delete layer" aria-label="Delete layer" disabled={!list.some((l) => l.id === active)} onClick={() => actions.deleteLayer(active)}>
          <Icon name="trash" size={15} />
        </button>
      </div>
      <div className="search-list" role="list" data-testid="search-layer-list">
        {list.map((l) => (
          <SearchRow key={l.id} layer={l} active={l.id === active} />
        ))}
        {!list.length && <p className="palette-note">No layers match the search.</p>}
      </div>
    </div>
  );
}
