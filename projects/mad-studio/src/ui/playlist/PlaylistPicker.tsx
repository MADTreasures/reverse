import { memo, useMemo } from 'react';
import type { Id } from '../../model/types';
import { clonePattern, deleteChannel, deletePattern, renamePattern, selectPattern, setChannelProps, setUi } from '../../store/actions';
import { useStore, type AppState, type PlaylistPick } from '../../store/store';
import { IconCurve, IconPiano, IconWave } from '../controls/Icons';
import { setDragItem } from '../dnd';
import { confirmDialog, promptDialog, showMenu } from '../overlays';
import { focusWindow, openChannelEditor, openWindow } from '../workspace/windows';

/** The playlist's current item: the picked clip source, or the selected pattern. */
export function currentPick(s: AppState): PlaylistPick {
  const pick = s.ui.playlistPick;
  if (pick) return pick;
  return { kind: 'pattern', id: s.ui.selectedPatternId };
}

/** Stable (memoized) version of currentPick for components. */
export function usePick(): PlaylistPick {
  const pick = useStore((s) => s.ui.playlistPick);
  const patternId = useStore((s) => s.ui.selectedPatternId);
  return useMemo(() => pick ?? { kind: 'pattern', id: patternId }, [pick, patternId]);
}

interface PickerItem {
  kind: PlaylistPick['kind'];
  id: Id;
  name: string;
  color: string;
}

function samePick(a: PlaylistPick, b: PickerItem): boolean {
  return a.kind === b.kind && a.id === b.id;
}

/** FL Studio's playlist picker panel: patterns, audio clips and automation clips of the project. */
export const PlaylistPicker = memo(function PlaylistPicker() {
  const patterns = useStore((s) => s.project.patterns);
  const channels = useStore((s) => s.project.channels);
  const show = useStore((s) => s.ui.pickerShow);
  const pick = usePick();

  const items: PickerItem[] = [];
  if (show.pattern) for (const p of patterns) items.push({ kind: 'pattern', id: p.id, name: p.name, color: p.color });
  if (show.audio)
    for (const c of channels) if (c.kind === 'sampler' && c.audioClip) items.push({ kind: 'audio', id: c.id, name: c.name, color: c.color });
  if (show.automation) for (const c of channels) if (c.kind === 'automation') items.push({ kind: 'automation', id: c.id, name: c.name, color: c.color });

  const choose = (it: PickerItem) => {
    if (it.kind === 'pattern') {
      selectPattern(it.id);
      setUi((u) => void (u.playlistPick = null));
    } else setUi((u) => void (u.playlistPick = { kind: it.kind, id: it.id }));
  };

  const menu = (e: React.MouseEvent, it: PickerItem) => {
    e.preventDefault();
    choose(it);
    if (it.kind === 'pattern') {
      showMenu(e, [
        { label: it.name, header: true },
        {
          label: 'Rename…',
          shortcut: 'F2',
          onClick: async () => {
            const name = await promptDialog('Rename pattern', it.name);
            if (name) renamePattern(it.id, name);
          },
        },
        { label: 'Clone', onClick: () => clonePattern(it.id) },
        {
          label: 'Delete…',
          danger: true,
          onClick: async () => {
            if (await confirmDialog('Delete pattern', `Delete "${it.name}" and its clips?`, 'Delete', true)) deletePattern(it.id);
          },
        },
      ]);
    } else {
      showMenu(e, [
        { label: it.name, header: true },
        { label: it.kind === 'automation' ? 'Edit automation…' : 'Channel settings…', onClick: () => openChannelEditor(it.id) },
        {
          label: 'Rename…',
          onClick: async () => {
            const name = await promptDialog('Rename', it.name);
            if (name) setChannelProps(it.id, { name });
          },
        },
        {
          label: 'Delete…',
          danger: true,
          onClick: async () => {
            if (await confirmDialog('Delete', `Delete "${it.name}" and all its clips?`, 'Delete', true)) deleteChannel(it.id);
          },
        },
      ]);
    }
  };

  const toggle = (kind: keyof typeof show) =>
    setUi((u) => {
      u.pickerShow[kind] = !u.pickerShow[kind];
    });

  return (
    <div className="picker" data-hint="Picker: click to choose what the draw tool places, drag into the playlist">
      <div className="picker-head">
        <button className={show.pattern ? 'active' : ''} data-hint="Show patterns" onClick={() => toggle('pattern')}>
          <IconPiano size={13} />
        </button>
        <button className={show.audio ? 'active' : ''} data-hint="Show audio clips" onClick={() => toggle('audio')}>
          <IconWave size={13} />
        </button>
        <button className={show.automation ? 'active' : ''} data-hint="Show automation clips" onClick={() => toggle('automation')}>
          <IconCurve size={13} />
        </button>
      </div>
      <div className="picker-list">
        {items.map((it) => (
          <button
            key={`${it.kind}:${it.id}`}
            className={`picker-item ${it.kind} ${samePick(pick, it) ? 'selected' : ''}`}
            style={{ ['--pc' as string]: it.color }}
            draggable
            onDragStart={(e) => setDragItem(e, { type: 'pick', kind: it.kind, id: it.id, name: it.name })}
            onClick={() => choose(it)}
            onDoubleClick={() => {
              if (it.kind === 'pattern') {
                openWindow('channelRack');
                focusWindow('channelRack');
              } else openChannelEditor(it.id);
            }}
            onContextMenu={(e) => menu(e, it)}
          >
            {it.kind === 'automation' ? <IconCurve size={11} /> : it.kind === 'audio' ? <IconWave size={11} /> : null}
            <span>{it.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
});
