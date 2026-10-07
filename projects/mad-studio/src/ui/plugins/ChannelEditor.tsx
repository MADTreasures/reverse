import { stepKey } from '../../model/patterns';
import { formatPan } from '../../model/timing';
import { setChannelProps } from '../../store/actions';
import { useStore } from '../../store/store';
import { DragNumber } from '../controls/DragNumber';
import { IconPiano, IconWave } from '../controls/Icons';
import { Knob } from '../controls/Knob';
import { WindowFrame } from '../workspace/WindowFrame';
import { openPianoRoll } from '../workspace/windows';
import { PreviewButton } from './common';
import { SamplerEditor } from './SamplerEditor';
import { SynthEditor } from './SynthEditor';

/** Instrument window for a channel: common strip settings plus the synth or sampler editor. */
export function ChannelEditor({ channelId }: { channelId: string }) {
  const channel = useStore((s) => s.project.channels.find((c) => c.id === channelId));
  const mixer = useStore((s) => s.project.mixer);
  if (!channel) return null;

  return (
    <WindowFrame
      id={`channel:${channelId}`}
      title={`${channel.name} – ${channel.kind === 'synth' ? 'Synth' : channel.audioClip ? 'Audio clip' : 'Sampler'}`}
      icon={channel.kind === 'synth' ? <IconPiano /> : <IconWave />}
      accent={channel.color}
    >
      <div className="plugin">
        <div className="plugin-header">
          <input
            type="text"
            defaultValue={channel.name}
            key={channel.name}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
            onBlur={(e) => e.target.value.trim() && e.target.value !== channel.name && setChannelProps(channel.id, { name: e.target.value })}
          />
          <div className="tb-group">
            <Knob size={24} label="Volume" value={channel.volume} min={0} max={1} defaultValue={0.8} format={(v) => `${Math.round(v * 100)}%`} onChange={(v, g) => setChannelProps(channel.id, { volume: v }, { coalesce: g })} />
            <span className="label">Vol</span>
            <Knob size={24} label="Pan" value={channel.pan} min={-1} max={1} defaultValue={0} bipolar format={formatPan} onChange={(v, g) => setChannelProps(channel.id, { pan: v }, { coalesce: g })} />
            <span className="label">Pan</span>
          </div>
          <div className="tb-group">
            <span className="label">Mixer</span>
            <DragNumber
              className="tb-number"
              value={channel.mixerTrack}
              min={0}
              max={mixer.length - 1}
              step={0.15}
              hint={`Mixer track (${mixer[channel.mixerTrack]?.name ?? ''})`}
              format={(v) => (v === 0 ? 'Master' : `${v} · ${mixer[v]?.name ?? ''}`)}
              onChange={(v, g) => setChannelProps(channel.id, { mixerTrack: v }, { coalesce: g })}
            />
          </div>
          <PreviewButton channelId={channel.id} note={stepKey(channel)} />
          <button className="btn" onClick={() => openPianoRoll(channel.id)}>
            Piano roll
          </button>
        </div>
        {channel.kind === 'synth' ? <SynthEditor channel={channel} /> : <SamplerEditor channel={channel} />}
      </div>
    </WindowFrame>
  );
}
