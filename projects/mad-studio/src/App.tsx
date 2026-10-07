import { useEffect, type DragEvent } from 'react';
import { addSamplerChannelFor, importAudioFiles, openProjectBytes, confirmDiscard } from './project/projectIO';
import { useStore } from './store/store';
import { Browser } from './ui/browser/Browser';
import { ChannelRack } from './ui/channelrack/ChannelRack';
import { audioFilesFromDrop, hasFiles } from './ui/dnd';
import { setHint } from './ui/hint';
import { Mixer } from './ui/mixer/Mixer';
import { OverlayHost } from './ui/OverlayHost';
import { toast } from './ui/overlays';
import { PianoRoll } from './ui/pianoroll/PianoRoll';
import { Playlist } from './ui/playlist/Playlist';
import { ChannelEditor } from './ui/plugins/ChannelEditor';
import { EffectEditor } from './ui/plugins/EffectEditor';
import { TopBar } from './ui/transport/TopBar';
import { PROJECT_EXTENSION } from './model/serialization';

export function App() {
  const browserOpen = useStore((s) => s.ui.browserOpen);

  useEffect(() => {
    // Hint bar: show the data-hint of whatever is under the pointer.
    let last: Element | null = null;
    const onOver = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.('[data-hint]') ?? null;
      if (el === last) return;
      last = el;
      setHint(el?.getAttribute('data-hint') ?? '');
    };
    window.addEventListener('mouseover', onOver);
    return () => window.removeEventListener('mouseover', onOver);
  }, []);

  // Files dropped anywhere that no editor handled: projects open, audio becomes channels.
  const onDragOver = (e: DragEvent) => {
    if (hasFiles(e)) e.preventDefault();
  };
  const onDrop = async (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    const files = [...e.dataTransfer.files];
    const project = files.find((f) => f.name.toLowerCase().endsWith(`.${PROJECT_EXTENSION}`));
    if (project) {
      if (await confirmDiscard()) await openProjectBytes({ name: project.name, data: new Uint8Array(await project.arrayBuffer()) });
      return;
    }
    const audio = await audioFilesFromDrop(e);
    if (audio.length === 0) {
      toast('Drop audio files (WAV, AIFF, MP3, …) or a .madstudio project.', 'error');
      return;
    }
    for (const s of await importAudioFiles(audio)) addSamplerChannelFor(s.info);
  };

  return (
    <div className="app" onDragOver={onDragOver} onDrop={onDrop} onContextMenu={(e) => e.preventDefault()}>
      <TopBar />
      <div className="main">
        {browserOpen && <Browser />}
        <Workspace />
      </div>
      <OverlayHost />
    </div>
  );
}

function Workspace() {
  const dynamicIds = useStore((s) =>
    Object.keys(s.ui.windows)
      .filter((id) => id.startsWith('channel:') || id.startsWith('effect:'))
      .join('|'),
  );
  const ids = dynamicIds ? dynamicIds.split('|') : [];
  return (
    <div className="workspace">
      <Playlist />
      <ChannelRack />
      <PianoRoll />
      <Mixer />
      {ids.map((id) =>
        id.startsWith('channel:') ? <ChannelEditor key={id} channelId={id.slice(8)} /> : <EffectEditor key={id} windowId={id} />,
      )}
    </div>
  );
}
