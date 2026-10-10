/**
 * Material palette, like the reference's: a strip of material buttons at the right edge of the
 * window opens the palette at a folder – the folder tree with its command bar (new, delete,
 * rename own folders), search keywords and tags on the left, the materials (details, large or
 * small thumbnails) on the right, the selected material's information (with Toning) below and a
 * command bar (view, paste to the canvas, favourite, delete). Materials are dragged onto the
 * canvas or the Layer palette, or pasted.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { childFolders, FAVORITES, folderPath, KIND_LABELS, materialsIn, searchMaterials, sortMaterials, tagsOf, type Material, type MaterialFolder } from '../../paint/materialLibrary';
import { materialThumbnail } from '../../engine/materialImages';
import {
  allFolders,
  allMaterials,
  applyMaterial,
  closeMaterialPalette,
  deleteMaterial,
  deleteMaterialFolder,
  MATERIAL_MIME,
  newMaterialFolder,
  renameMaterialFolder,
  selectMaterial,
  setKeywords,
  setMaterialView,
  setToning,
  showFolder,
  toggleExpanded,
  toggleFavorite,
  toggleMaterialPalette,
  toggleTag,
  useMaterials,
  type MaterialView,
} from '../../store/materialActions';
import { confirmDialog, promptDialog } from '../overlays';
import { Icon } from '../controls/Icons';

/** The strip's buttons: Material palettes opened at these folders. */
const STRIP: [string, string, string][] = [
  ['all', 'Material [All materials]', 'material'],
  ['color', 'Material [Color pattern]', 'colorPattern'],
  ['mono', 'Material [Monochromatic pattern]', 'monoPattern'],
  ['manga', 'Material [Manga material]', 'mangaMaterial'],
  ['image', 'Material [Image material]', 'imageLayer'],
  [FAVORITES, 'Material [Favorites]', 'heart'],
];

/** The strip at the right edge of the window. */
export function MaterialStrip() {
  const open = useMaterials((s) => s.open);
  return (
    <aside className="material-strip" role="toolbar" aria-label="Materials" data-testid="material-strip">
      {STRIP.map(([id, label, icon]) => (
        <button key={id} className={`icon-btn ${open === id ? 'on' : ''}`} title={label} aria-label={label} aria-pressed={open === id} onClick={() => toggleMaterialPalette(id)}>
          <Icon name={icon} size={18} />
        </button>
      ))}
      {open !== null && <MaterialPalette />}
    </aside>
  );
}

function Thumb({ m, size }: { m: Material; size: number }) {
  const image = useMaterials((s) => (m.own ? s.images[m.id] : undefined));
  const url = useMemo(() => materialThumbnail(m, image, 96), [m, image]);
  return <img className="material-thumb" src={url} alt="" width={size} height={size} draggable={false} />;
}

function FolderRow({ f, depth, folders }: { f: MaterialFolder; depth: number; folders: MaterialFolder[] }) {
  const open = useMaterials((s) => s.open);
  const expanded = useMaterials((s) => s.expanded.includes(f.id));
  const kids = childFolders(folders, f.id);
  return (
    <>
      <div className={`material-folder ${open === f.id ? 'on' : ''}`} style={{ paddingLeft: 4 + depth * 12 }} role="treeitem" aria-selected={open === f.id} aria-expanded={kids.length ? expanded : undefined}>
        {kids.length > 0 ? (
          <button className="folder-twist" aria-label={expanded ? 'Collapse' : 'Expand'} onClick={() => toggleExpanded(f.id)}>
            {expanded ? '▾' : '▸'}
          </button>
        ) : (
          <span className="folder-twist" />
        )}
        <button className="folder-name" onClick={() => showFolder(f.id)} onDoubleClick={() => toggleExpanded(f.id)}>
          {f.name}
        </button>
      </div>
      {expanded && kids.map((k) => <FolderRow key={k.id} f={k} depth={depth + 1} folders={folders} />)}
    </>
  );
}

const VIEWS: [MaterialView, string][] = [
  ['details', 'Details'],
  ['large', 'Large thumbnails'],
  ['small', 'Small thumbnails'],
];

/** The palette shown next to the strip. */
export function MaterialPalette() {
  const s = useMaterials(
    useShallow((x) => ({
      open: x.open!,
      selected: x.selected,
      view: x.view,
      sort: x.sort,
      descending: x.descending,
      keywords: x.keywords,
      tags: x.tags,
      favorites: x.favorites,
      toning: x.toning,
      own: x.own,
      ownFolders: x.ownFolders,
    })),
  );
  const folders = useMemo(() => allFolders(), [s.ownFolders]);
  const shown = useMemo(() => {
    const inFolder = materialsIn(allMaterials(), folders, s.open, new Set(s.favorites));
    return sortMaterials(searchMaterials(inFolder, s.keywords, s.tags), s.sort, s.descending);
  }, [folders, s.open, s.favorites, s.keywords, s.tags, s.sort, s.descending, s.own]);
  const tags = useMemo(() => tagsOf(materialsIn(allMaterials(), folders, s.open, new Set(s.favorites))), [folders, s.open, s.favorites, s.own]);
  const selected = shown.find((m) => m.id === s.selected) ?? allMaterials().find((m) => m.id === s.selected) ?? null;
  const folder = folders.find((f) => f.id === s.open);
  const panel = useRef<HTMLDivElement>(null);

  // Escape closes it; a click elsewhere (but on the strip) too, as an auto-hidden palette.
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && closeMaterialPalette();
    const down = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!t || t.closest('.material-palette, .material-strip, .modal, .context-menu, .toast')) return;
      closeMaterialPalette();
    };
    window.addEventListener('keydown', key);
    window.addEventListener('pointerdown', down, true);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('pointerdown', down, true);
    };
  }, []);

  const own = folder?.own ?? false;
  const size = s.view === 'small' ? 48 : s.view === 'large' ? 84 : 36;
  return (
    <div className="material-palette" ref={panel} role="dialog" aria-label="Material palette" data-testid="material-palette">
      <div className="palette-titlebar">
        <span>Material: {folder?.name ?? ''}</span>
        <button className="icon-btn" aria-label="Close material palette" title="Close" onClick={closeMaterialPalette}>
          ×
        </button>
      </div>
      <div className="material-body">
        <div className="material-side">
          <div className="material-tree" role="tree" aria-label="Material folders">
            {folders
              .filter((f) => f.parent === null)
              .map((f) => (
                <FolderRow key={f.id} f={f} depth={0} folders={folders} />
              ))}
          </div>
          <div className="material-folder-bar">
            <button
              className="icon-btn"
              title="New folder"
              aria-label="New folder"
              disabled={s.open === FAVORITES}
              onClick={async () => {
                const name = await promptDialog('New folder', 'New folder');
                if (name) {
                  const id = newMaterialFolder(s.open, name);
                  if (id) showFolder(id);
                }
              }}
            >
              <Icon name="newFolder" size={15} />
            </button>
            <button
              className="icon-btn"
              title="Delete folder (with its materials)"
              aria-label="Delete folder"
              disabled={!own}
              onClick={async () => {
                if (folder && (await confirmDialog('Delete folder', `Delete "${folder.name}" and the materials in it?`, 'Delete', true))) deleteMaterialFolder(folder.id);
              }}
            >
              <Icon name="trash" size={15} />
            </button>
            <button
              className="icon-btn"
              title="Change name"
              aria-label="Rename folder"
              disabled={!own}
              onClick={async () => {
                if (!folder) return;
                const name = await promptDialog('Change name', folder.name);
                if (name) renameMaterialFolder(folder.id, name);
              }}
            >
              <Icon name="rename" size={15} />
            </button>
          </div>
          <input className="material-search" type="search" placeholder="Type search keywords" aria-label="Search materials" value={s.keywords} onChange={(e) => setKeywords(e.target.value)} />
          <div className="material-tags" aria-label="Tags">
            {tags.map((t) => (
              <button key={t} className={`material-tag ${s.tags.includes(t) ? 'on' : ''}`} aria-pressed={s.tags.includes(t)} onClick={() => toggleTag(t)}>
                {t}
              </button>
            ))}
          </div>
        </div>
        <div className={`material-list view-${s.view}`} role="listbox" aria-label="Materials" data-testid="material-list">
          {shown.length === 0 && <div className="prop-note">No materials here.</div>}
          {shown.map((m) => (
            <div
              key={m.id}
              role="option"
              aria-selected={s.selected === m.id}
              aria-label={m.name}
              title={`${m.name} – drag onto the canvas (double-click pastes it)`}
              className={`material-item ${s.selected === m.id ? 'on' : ''}`}
              draggable
              data-material={m.id}
              onClick={() => selectMaterial(m.id)}
              onDoubleClick={() => applyMaterial(m.id)}
              onDragStart={(e) => {
                selectMaterial(m.id);
                e.dataTransfer.setData(MATERIAL_MIME, m.id);
                e.dataTransfer.effectAllowed = 'copy';
              }}
            >
              <Thumb m={m} size={size} />
              <span className="material-name">{m.name}</span>
              {s.view === 'details' && <span className="material-kind">{KIND_LABELS[m.spec.kind]}</span>}
            </div>
          ))}
        </div>
      </div>
      <div className="material-info" data-testid="material-info">
        {selected ? (
          <>
            <Thumb m={selected} size={64} />
            <div className="material-info-text">
              <strong>{selected.name}</strong>
              <span>Type: {KIND_LABELS[selected.spec.kind]}</span>
              {selected.tags.length > 0 && <span>Tags: {selected.tags.join(', ')}</span>}
              <span>Folder: {folderPath(folders, selected.folder)}</span>
              {selected.spec.kind === 'image' && (
                <label className="check">
                  <input type="checkbox" checked={Boolean(s.toning[selected.id])} onChange={(e) => setToning(selected.id, e.target.checked)} />
                  Toning
                </label>
              )}
            </div>
          </>
        ) : (
          <span className="prop-note">Select a material to see what it is.</span>
        )}
      </div>
      <div className="material-command-bar">
        {VIEWS.map(([v, label]) => (
          <button key={v} className={`icon-btn ${s.view === v ? 'on' : ''}`} title={label} aria-label={label} aria-pressed={s.view === v} onClick={() => setMaterialView(v)}>
            <Icon name={v === 'details' ? 'listView' : v === 'large' ? 'largeThumbs' : 'smallThumbs'} size={15} />
          </button>
        ))}
        <span className="spacer" />
        <button className="icon-btn" title="Paste selected material to canvas" aria-label="Paste material to canvas" disabled={!selected} onClick={() => selected && applyMaterial(selected.id)}>
          <Icon name="pasteMaterial" size={15} />
        </button>
        <button
          className={`icon-btn ${selected && s.favorites.includes(selected.id) ? 'on' : ''}`}
          title="Add to favorites"
          aria-label="Add to favorites"
          aria-pressed={Boolean(selected && s.favorites.includes(selected.id))}
          disabled={!selected}
          onClick={() => toggleFavorite()}
        >
          <Icon name="heart" size={15} />
        </button>
        <button
          className="icon-btn"
          title="Delete material"
          aria-label="Delete material"
          disabled={!selected?.own}
          onClick={async () => {
            if (selected?.own && (await confirmDialog('Delete material', `Delete "${selected.name}"?`, 'Delete', true))) deleteMaterial(selected.id);
          }}
        >
          <Icon name="trash" size={15} />
        </button>
      </div>
    </div>
  );
}
