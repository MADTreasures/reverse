import { describe, expect, it } from 'vitest';
import {
  ALL_MATERIALS,
  BUILT_IN_FOLDERS,
  BUILT_IN_MATERIALS,
  childFolders,
  FAVORITES,
  folderPath,
  inFolder,
  materialsIn,
  OWN_IMAGES,
  sanitizeOwnFolders,
  sanitizeOwnMaterial,
  searchMaterials,
  sortMaterials,
  tagsOf,
} from './materialLibrary';

describe('material library', () => {
  it('has a folder tree like the reference and every material in a folder of it', () => {
    expect(childFolders(BUILT_IN_FOLDERS, ALL_MATERIALS).map((f) => f.name)).toEqual(['Color pattern', 'Monochromatic pattern', 'Manga material', 'Image material', 'Favorites']);
    const ids = new Set(BUILT_IN_FOLDERS.map((f) => f.id));
    for (const m of BUILT_IN_MATERIALS) expect(ids.has(m.folder)).toBe(true);
    expect(new Set(BUILT_IN_MATERIALS.map((m) => m.id)).size).toBe(BUILT_IN_MATERIALS.length);
    expect(inFolder(BUILT_IN_FOLDERS, 'color/pattern', 'color')).toBe(true);
    expect(inFolder(BUILT_IN_FOLDERS, 'color/pattern', 'mono')).toBe(false);
    expect(folderPath(BUILT_IN_FOLDERS, 'manga/lines')).toBe('Manga material > Effect lines');
  });

  it('shows a folder with the folders inside it; Favorites shows the favourites', () => {
    const color = materialsIn(BUILT_IN_MATERIALS, BUILT_IN_FOLDERS, 'color', new Set());
    expect(color.some((m) => m.id === 'pat-polka')).toBe(true);
    expect(color.some((m) => m.id === 'tex-wood')).toBe(true);
    expect(color.some((m) => m.spec.kind === 'tone')).toBe(false);
    expect(materialsIn(BUILT_IN_MATERIALS, BUILT_IN_FOLDERS, ALL_MATERIALS, new Set())).toHaveLength(BUILT_IN_MATERIALS.length);
    expect(materialsIn(BUILT_IN_MATERIALS, BUILT_IN_FOLDERS, FAVORITES, new Set(['pat-check', 'tone-dot30'])).map((m) => m.id)).toEqual(['pat-check', 'tone-dot30']);
  });

  it('finds materials by keywords and tags, and sorts them', () => {
    expect(searchMaterials(BUILT_IN_MATERIALS, 'polka').map((m) => m.id)).toEqual(['pat-polka']);
    // Every keyword, in the name or a tag, any case.
    expect(searchMaterials(BUILT_IN_MATERIALS, 'seamless JAPANESE').every((m) => m.tags.includes('Japanese'))).toBe(true);
    expect(searchMaterials(BUILT_IN_MATERIALS, '', ['Tone']).every((m) => m.spec.kind === 'tone')).toBe(true);
    expect(searchMaterials(BUILT_IN_MATERIALS, '', ['Speed lines']).length).toBe(4);
    const tags = tagsOf(BUILT_IN_MATERIALS);
    expect(tags[0]).toBe('Image material');
    expect(tags).toContain('Seamless');
    const names = sortMaterials(materialsIn(BUILT_IN_MATERIALS, BUILT_IN_FOLDERS, 'mono/tone', new Set()), 'name').map((m) => m.name);
    expect(names).toEqual([...names].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())));
    expect(sortMaterials([{ ...BUILT_IN_MATERIALS[0], added: 5 }, { ...BUILT_IN_MATERIALS[1], added: 9 }], 'added', true).map((m) => m.added)).toEqual([9, 5]);
  });

  it('reads the user’s folders and materials from storage safely', () => {
    const folders = sanitizeOwnFolders([
      { id: 'own-b', name: 'Inner', parent: 'own-a' },
      { id: 'own-a', name: '  Mine  ', parent: 'image' },
      { id: 'own-c', name: 'Lost', parent: 'nowhere' },
      { id: 'color', name: 'Taken', parent: 'all' },
      { id: 'own-d', name: 'Fav', parent: FAVORITES },
    ]);
    expect(folders.map((f) => [f.id, f.name, f.parent])).toEqual([
      ['own-a', 'Mine', 'image'],
      ['own-b', 'Inner', 'own-a'],
    ]);
    const all = [...BUILT_IN_FOLDERS, ...folders];
    expect(sanitizeOwnMaterial({ id: 'own-m1', name: 'Cat', folder: 'own-b', tags: ['pet', 'pet', 3], spec: { tiled: true } }, all)).toMatchObject({ folder: 'own-b', tags: ['pet'], spec: { kind: 'image', tiled: true }, own: true });
    expect(sanitizeOwnMaterial({ id: 'own-m2', folder: 'gone' }, all)!.folder).toBe(OWN_IMAGES);
    expect(sanitizeOwnMaterial({ id: 'pat-check' }, all)).toBeNull();
  });
});
