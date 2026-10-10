/**
 * Edit > Register material > Image, like the reference's Material property dialog: the image of
 * the current layer (in the selection, else all it shows) is stored as a material with a name, a
 * place in the Material palette's folders, tags, and whether it is a tiled pattern.
 */
import { useState } from 'react';
import { BUILT_IN_FOLDERS, FAVORITES, folderPath, OWN_IMAGES } from '../../paint/materialLibrary';
import { allFolders, registerMaterial, showFolder, useMaterials } from '../../store/materialActions';
import { closeDialog, toast } from '../overlays';

export function RegisterMaterialDialog() {
  const ownFolders = useMaterials((s) => s.ownFolders);
  const folders = [...BUILT_IN_FOLDERS, ...ownFolders].filter((f) => f.id !== 'all' && f.id !== FAVORITES);
  const [name, setName] = useState('Material');
  const [folder, setFolder] = useState(OWN_IMAGES);
  const [tags, setTags] = useState('');
  const [tiled, setTiled] = useState(false);
  return (
    <form
      className="modal"
      role="dialog"
      aria-label="Material property"
      onSubmit={(e) => {
        e.preventDefault();
        const id = registerMaterial(
          name,
          folder,
          tags.split(',').map((t) => t.trim()),
          tiled,
        );
        closeDialog();
        if (id) {
          toast(`Registered "${name.trim() || 'Material'}" in ${folderPath(allFolders(), folder)}`);
          showFolder(folder);
        }
      }}
    >
      <h2>Material property</h2>
      <div className="form-grid">
        <label htmlFor="material-name">Material name</label>
        <input id="material-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} autoFocus />
        <label htmlFor="material-folder">Location to save material</label>
        <select id="material-folder" value={folder} onChange={(e) => setFolder(e.target.value)}>
          {folders.map((f) => (
            <option key={f.id} value={f.id}>
              {folderPath(allFolders(), f.id)}
            </option>
          ))}
        </select>
        <label htmlFor="material-tags">Search tags</label>
        <input id="material-tags" placeholder="e.g. Background, Sky" value={tags} onChange={(e) => setTags(e.target.value)} />
        <label />
        <label className="check">
          <input type="checkbox" checked={tiled} onChange={(e) => setTiled(e.target.checked)} />
          Tiling (a seamless pattern)
        </label>
      </div>
      <p className="muted">The image of the current layer – inside the selection, or all it shows – becomes a material in the Material palette.</p>
      <div className="modal-actions">
        <button type="button" className="btn" onClick={closeDialog}>
          Cancel
        </button>
        <button type="submit" className="btn primary">
          OK
        </button>
      </div>
    </form>
  );
}
