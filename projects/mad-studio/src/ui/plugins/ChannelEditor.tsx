import { useState } from 'react';
import { channelTarget } from '../../model/automationTargets';
import { stepKey } from '../../model/patterns';
import { formatPan } from '../../model/timing';
import type { Channel } from '../../model/types';
import { instanceKeyForChannel } from '../../plugins/pluginStore';
import { setChannelProps } from '../../store/actions';
import { useStore } from '../../store/store';
import { DragNumber } from '../controls/DragNumber';
import { IconCurve, IconPiano, IconPlug, IconWave } from '../controls/Icons';
import { Knob } from '../controls/Knob';
import { WindowFrame } from '../workspace/WindowFrame';
import { openPianoRoll } from '../workspace/windows';
import { AutomationEditor } from './AutomationEditor';
import { ChannelSettingsPanel } from './ChannelSettingsPanel';
import { PreviewButton } from './common';
import { PluginWrapper } from './PluginWrapper';
import { SamplerEditor } from './SamplerEditor';
import { SynthEditor } from './SynthEditor';

function kindLabel(channel: Channel): string {
  switch (channel.kind) {
    case 'synth':
      return 'Synth';
    case 'sampler':
      return channel.audioClip ? 'Audio clip' : 'Sampler';
    case 'plugin':
      return channel.plugin.name;
    case 'automation':
      return 'Automation clip';
  }
}

function kindIcon(channel: Channel) {
  switch (channel.kind) {
    case 'synth':
      return <IconPiano />;
    case 'sampler':
      return <IconWave />;
    case 'plugin':
      return <IconPlug />;
    case 'automation':
      return <IconCurve />;
  }
}

/** Channel settings window (FL Studio's channel settings / plugin wrapper). */
export function ChannelEditor({ channelId }: { channelId: string }) {
  const channel = useStore((s) => s.project.channels.find((c) => c.id === channelId));
  const mixer = useStore((s) => s.project.mixer);
  const [tab, setTab] = useState<'instrument' | 'misc'>('instrument');
  if (!channel) return null;
  const isAutomation = channel.kind === 'automation';
  const hasSettings = channel.kind === 'synth' || channel.kind === 'plugin' || (channel.kind === 'sampler' && !channel.audioClip);
  const showMisc = hasSettings && tab === 'misc';

  return (
    <WindowFrame id={`channel:${channelId}`} title={`${channel.name} – ${kindLabel(channel)}`} icon={kindIcon(channel)} accent={channel.color}>
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
          {!isAutomation && (
            <>
              <div className="tb-group">
                <Knob
                  size={24}
                  label={`${channel.name} volume`}
                  value={channel.volume}
                  min={0}
                  max={1}
                  defaultValue={0.8}
                  format={(v) => `${Math.round(v * 100)}%`}
                  target={channelTarget(channel.id, 'volume')}
                  onChange={(v, g) => setChannelProps(channel.id, { volume: v }, { coalesce: g })}
                />
                <span className="label">Vol</span>
                <Knob
                  size={24}
                  label={`${channel.name} pan`}
                  value={channel.pan}
                  min={-1}
                  max={1}
                  defaultValue={0}
                  bipolar
                  format={formatPan}
                  target={channelTarget(channel.id, 'pan')}
                  onChange={(v, g) => setChannelProps(channel.id, { pan: v }, { coalesce: g })}
                />
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
            </>
          )}
          {hasSettings && (
            <div className="seg channel-tabs" role="tablist" aria-label="Channel settings page">
              <button role="tab" aria-selected={tab === 'instrument'} className={tab === 'instrument' ? 'active' : ''} onClick={() => setTab('instrument')}>
                {channel.kind === 'plugin' ? 'Plugin' : 'Instrument'}
              </button>
              <button role="tab" aria-selected={tab === 'misc'} className={tab === 'misc' ? 'active' : ''} data-hint="Polyphony, portamento and arpeggiator (FL Studio: channel settings › Misc)" onClick={() => setTab('misc')}>
                Misc
              </button>
            </div>
          )}
        </div>
        {showMisc && (channel.kind === 'synth' || channel.kind === 'plugin' || channel.kind === 'sampler') && <ChannelSettingsPanel channel={channel} />}
        {!showMisc && channel.kind === 'synth' && <SynthEditor channel={channel} />}
        {!showMisc && channel.kind === 'sampler' && <SamplerEditor channel={channel} />}
        {!showMisc && channel.kind === 'plugin' && <PluginWrapper instanceKey={instanceKeyForChannel(channel.id)} plugin={channel.plugin} title={`${channel.name} – ${channel.plugin.name}`} />}
        {channel.kind === 'automation' && <AutomationEditor channel={channel} />}
      </div>
    </WindowFrame>
  );
}
