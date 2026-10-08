import { useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { engine } from '../../audio/engine';
import { FACTORY_SAMPLES, factorySampleId } from '../../model/factory';
import { SYNTH_PRESETS } from '../../model/presets';
import { addSamplerChannelFor, importSamplesDialog } from '../../project/projectIO';
import { addFactoryChannel, addSynthChannel, setUi } from '../../store/actions';
import { useStore } from '../../store/store';
import { IconChevronDown, IconChevronRight, IconPlus, IconWave } from '../controls/Icons';
import { setDragItem, type DragItem } from '../dnd';

interface Entry {
  key: string;
  name: string;
  kind: 'sample' | 'preset';
  drag: DragItem;
  preview: () => void;
  add: () => void;
}

interface Folder {
  id: string;
  name: string;
  entries: Entry[];
}

function factoryFolders(): Folder[] {
  const byCat = new Map<string, Entry[]>();
  for (const s of FACTORY_SAMPLES) {
    const list = byCat.get(s.category) ?? [];
    list.push({
      key: s.key,
      name: s.name,
      kind: 'sample',
      drag: { type: 'sample', sampleId: factorySampleId(s.key), name: s.name, factoryKey: s.key },
      preview: () => engine.previewSample(factorySampleId(s.key)),
      add: () => addFactoryChannel(s.key),
    });
    byCat.set(s.category, list);
  }
  return [...byCat.entries()].map(([name, entries]) => ({ id: `f:${name}`, name, entries }));
}

function presetFolders(): Folder[] {
  const byCat = new Map<string, Entry[]>();
  for (const p of SYNTH_PRESETS) {
    const list = byCat.get(p.category) ?? [];
    list.push({
      key: p.id,
      name: p.name,
      kind: 'preset',
      drag: { type: 'preset', presetId: p.id, name: p.name },
      preview: () => engine.previewPreset(p.id),
      add: () => addSynthChannel(p.id),
    });
    byCat.set(p.category, list);
  }
  return [...byCat.entries()].map(([name, entries]) => ({ id: `p:${name}`, name, entries }));
}

export function Browser() {
  const width = useStore((s) => s.ui.browserWidth);
  const samples = useStore((s) => s.project.samples);
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({ 'f:Kicks': true, 'f:Snares & Claps': true, imported: true, recorded: true });

  const sections = useMemo(() => {
    const entry = (s: (typeof samples)[string]): Entry => ({
        key: s.id,
        name: s.name,
        kind: 'sample',
        drag: { type: 'sample', sampleId: s.id, name: s.name },
        preview: () => engine.previewSample(s.id),
        add: () => addSamplerChannelFor(s),
      });
    const user = Object.values(samples).filter((s) => s.source === 'user');
    return [
      { title: 'Drums & FX', folders: factoryFolders() },
      { title: 'Synth presets', folders: presetFolders() },
      {
        title: 'Project samples',
        folders: [
          { id: 'imported', name: 'Imported', entries: user.filter((s) => !s.recorded).map(entry) },
          // FL Studio keeps audio recordings in a "Recorded" browser folder.
          { id: 'recorded', name: 'Recorded', entries: user.filter((s) => s.recorded).map(entry) },
        ],
      },
    ];
  }, [samples]);

  const q = filter.trim().toLowerCase();

  const startResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startW = width;
    const move = (ev: PointerEvent) =>
      setUi((d) => {
        d.browserWidth = Math.min(420, Math.max(160, startW + ev.clientX - startX));
      });
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <aside className="browser" style={{ width }}>
      <div className="browser-head">
        <span className="label">Browser</span>
        <button className="icon-btn" data-hint="Import audio files into the project" onClick={() => void importSamplesDialog()}>
          <IconPlus size={12} />
        </button>
      </div>
      <input
        type="text"
        className="browser-search"
        placeholder="Search…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        onKeyDown={(e) => e.stopPropagation()}
      />
      <div className="browser-tree">
        {sections.map((section) => (
          <div key={section.title} className="browser-section">
            <div className="browser-section-title">{section.title}</div>
            {section.folders.map((folder) => {
              const entries = q ? folder.entries.filter((en) => en.name.toLowerCase().includes(q)) : folder.entries;
              if (q && entries.length === 0) return null;
              const isOpen = q ? true : (open[folder.id] ?? false);
              return (
                <div key={folder.id} className="browser-folder">
                  <button className="folder-row" onClick={() => setOpen((o) => ({ ...o, [folder.id]: !isOpen }))}>
                    {isOpen ? <IconChevronDown size={10} /> : <IconChevronRight size={10} />}
                    <span>{folder.name}</span>
                    <span className="faint">{entries.length}</span>
                  </button>
                  {isOpen &&
                    (entries.length === 0 ? (
                      <div className="browser-empty">
                        {folder.id === 'recorded' ? 'Audio you record on armed mixer tracks appears here.' : 'Drop audio files here or use + to import.'}
                      </div>
                    ) : (
                      entries.map((en) => (
                        <div
                          key={en.key}
                          className={`browser-item ${en.kind}`}
                          draggable
                          onDragStart={(e) => setDragItem(e, en.drag)}
                          onClick={en.preview}
                          onDoubleClick={en.add}
                          data-hint={`${en.name} – click: preview, double-click: add channel, drag: rack/playlist`}
                        >
                          <span className="item-icon">{en.kind === 'sample' ? <IconWave size={11} /> : '♪'}</span>
                          <span className="item-name">{en.name}</span>
                        </div>
                      ))
                    ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="browser-resize" onPointerDown={startResize} />
    </aside>
  );
}
