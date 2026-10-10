import { ARP_DIRECTIONS, ARP_TIMES, MAX_POLYPHONY, channelSettings } from '../../model/channelSettings';
import { CHORDS } from '../../model/scales';
import type { AudioChannel, ArpDirection, ChannelSettings } from '../../model/types';
import { updateChannelSettings } from '../../store/actions';
import { DragNumber } from '../controls/DragNumber';
import { Knob } from '../controls/Knob';

/**
 * FL Studio's channel settings › Misc: polyphony (Max, Mono, Porta, Slide) and the arpeggiator. They
 * apply to sequenced notes (both engines get the result) and to notes played live.
 */
export function ChannelSettingsPanel({ channel }: { channel: AudioChannel }) {
  const st = channelSettings(channel);
  const set = (recipe: (s: ChannelSettings) => void, gesture?: string) => updateChannelSettings(channel.id, recipe, gesture ? { coalesce: gesture } : undefined);
  const arpOn = st.arp.direction !== 'off';

  return (
    <div className="plugin-sections channel-settings">
      <div className="plugin-section">
        <div className="section-title">Polyphony</div>
        <div className="knob-row" style={{ alignItems: 'center' }}>
          <div className="knob-cell">
            <DragNumber
              className="tb-number"
              value={st.polyphony}
              min={0}
              max={MAX_POLYPHONY}
              step={0.2}
              hint="Max: most voices at once (Off = the instrument's default)"
              format={(v) => (v === 0 ? 'Off' : String(v))}
              onChange={(v, g) => set((s) => void (s.polyphony = v), g)}
            />
            <span className="cell-label">Max</span>
          </div>
          <label className="cs-check" data-hint="Mono: one note at a time, a new note ends the previous one">
            <input type="checkbox" checked={st.mono} onChange={(e) => set((s) => void (s.mono = e.target.checked))} />
            Mono
          </label>
          <label className="cs-check" data-hint="Porta: every note glides from the previous one (slide time)">
            <input type="checkbox" checked={st.porta} onChange={(e) => set((s) => void (s.porta = e.target.checked))} />
            Porta
          </label>
          <div className="knob-cell">
            <Knob
              size={26}
              label="Slide"
              value={st.glide}
              min={0}
              max={2}
              defaultValue={0.1}
              format={(v) => `${Math.round(v * 1000)} ms`}
              onChange={(v, g) => set((s) => void (s.glide = v), g)}
            />
            <span className="cell-label">Slide</span>
          </div>
        </div>
      </div>
      <div className={`plugin-section grow ${arpOn ? '' : 'dimmed'}`}>
        <div className="section-title">Arpeggiator</div>
        <div className="knob-row" style={{ alignItems: 'center' }}>
          <label className="cs-select">
            <span>Direction</span>
            <select value={st.arp.direction} aria-label="Arpeggiator direction" onChange={(e) => set((s) => void (s.arp.direction = e.target.value as ArpDirection))}>
              {ARP_DIRECTIONS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
          <div className="knob-cell">
            <DragNumber
              className="tb-number"
              value={st.arp.range}
              min={1}
              max={4}
              step={0.05}
              hint="Range in octaves"
              format={(v) => `${v} oct`}
              onChange={(v, g) => set((s) => void (s.arp.range = v), g)}
            />
            <span className="cell-label">Range</span>
          </div>
          <label className="cs-select">
            <span>Time</span>
            <select value={String(st.arp.time)} aria-label="Arpeggiator time" onChange={(e) => set((s) => void (s.arp.time = Number(e.target.value)))}>
              {ARP_TIMES.map((t) => (
                <option key={t.value} value={String(t.value)}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <div className="knob-cell">
            <Knob
              size={26}
              label="Gate"
              value={st.arp.gate}
              min={0.05}
              max={1}
              defaultValue={0.9}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(v, g) => set((s) => void (s.arp.gate = v), g)}
            />
            <span className="cell-label">Gate</span>
          </div>
          <div className="knob-cell">
            <DragNumber
              className="tb-number"
              value={st.arp.repeat}
              min={1}
              max={8}
              step={0.05}
              hint="Repeat: how often each note plays"
              format={(v) => `×${v}`}
              onChange={(v, g) => set((s) => void (s.arp.repeat = v), g)}
            />
            <span className="cell-label">Repeat</span>
          </div>
          <label className="cs-select">
            <span>Chord</span>
            <select value={st.arp.chord} aria-label="Arpeggiator chord" data-hint="A single held note is expanded to this chord" onChange={(e) => set((s) => void (s.arp.chord = e.target.value))}>
              <option value="none">None</option>
              {CHORDS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
    </div>
  );
}
