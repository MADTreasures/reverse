/**
 * Timeline palette: a track per animation folder with its cels per frame, the frame ruler, playback
 * (start, previous, play/stop, next, end, loop), new animation folder / cel, delete assigned cel and
 * onion skin. Right-click or double-click a frame of a track to assign a cel to it.
 */
import { useMemo, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { animationFolders, type AnimationFolder } from '../../model/animation';
import { assignmentAt, entryAt } from '../../paint/animation';
import * as actions from '../../store/actions';
import * as anim from '../../store/animationActions';
import { getState, setState, useStore } from '../../store/store';
import { Icon } from '../controls/Icons';
import { openDialog, showMenu, type MenuItem } from '../overlays';

const CELL = 24;

function Button({ icon, label, onClick, on, disabled }: { icon: string; label: string; onClick: () => void; on?: boolean; disabled?: boolean }) {
  return (
    <button className={`icon-btn ${on ? 'on' : ''}`} title={label} aria-label={label} aria-pressed={on === undefined ? undefined : on} disabled={disabled} onClick={onClick}>
      <Icon name={icon} />
    </button>
  );
}

/** The menu that assigns a cel of the track to a frame (the reference's pop-up on a frame). */
function assignMenu(track: AnimationFolder, frame: number): MenuItem[] {
  const entry = entryAt(track.animation, frame);
  return [
    ...track.children.map((c) => ({ label: c.name, checked: entry?.cel === c.id, onClick: () => anim.assignCel(track.id, frame, c.id) })),
    ...(track.children.length ? [{ separator: true }] : []),
    { label: 'Blank (no cel)', checked: entry !== undefined && entry.cel === null, onClick: () => anim.assignCel(track.id, frame, null) },
    { label: 'Delete assigned cel', disabled: !entry, onClick: () => anim.removeAssignedCel(track.id, frame) },
    { separator: true },
    {
      label: 'New animation cel',
      onClick: () => {
        anim.selectTrackFrame(track.id, frame);
        anim.newAnimationCel();
      },
    },
  ];
}

/** Animation > Edit track > Assign cel to frame: the menu for the current track's current frame. */
export function openAssignMenu(): void {
  const s = getState();
  const track = anim.activeTrack(s);
  if (!track) {
    setState({ hint: 'Select an animation folder or one of its cels' });
    return;
  }
  const el = document.querySelector(`[data-testid=timeline] [data-track-id="${track.id}"] .tl-cell[data-frame="${s.frame}"]`);
  const box = el?.getBoundingClientRect();
  showMenu({ x: box?.left ?? window.innerWidth / 2, y: box ? box.bottom + 2 : window.innerHeight / 2 }, assignMenu(track, s.frame));
}

function TrackRow({ track, frames, frame, active }: { track: AnimationFolder; frames: number; frame: number; active: boolean }) {
  const cells = [];
  for (let f = 1; f <= frames; f++) {
    const entry = entryAt(track.animation, f);
    const shown = assignmentAt(track.animation, f);
    const cel = entry?.cel ? track.children.find((c) => c.id === entry.cel) : undefined;
    const kind = entry ? (entry.cel ? 'start' : 'blank') : shown?.cel ? 'hold' : '';
    cells.push(
      <div
        key={f}
        className={`tl-cell ${kind} ${f === frame ? 'current' : ''}`}
        data-frame={f}
        title={cel ? `Frame ${f}: ${cel.name}` : `Frame ${f}`}
        onClick={() => anim.selectTrackFrame(track.id, f)}
        onDoubleClick={(e) => showMenu({ x: e.clientX, y: e.clientY }, assignMenu(track, f))}
        onContextMenu={(e) => {
          e.preventDefault();
          anim.selectTrackFrame(track.id, f);
          showMenu({ x: e.clientX, y: e.clientY }, assignMenu(track, f));
        }}
      >
        {kind === 'start' && <span className="tl-cel-name">{cel?.name}</span>}
        {kind === 'blank' && <span className="tl-cel-name">×</span>}
      </div>,
    );
  }
  return (
    <div className={`tl-row ${active ? 'active' : ''}`} data-testid="timeline-track" data-track={track.name} data-track-id={track.id}>
      <div className="tl-name">
        <button className={`eye ${track.visible ? 'on' : ''}`} aria-label={track.visible ? 'Hide track' : 'Show track'} onClick={() => actions.setLayerProps(track.id, { visible: !track.visible }, 'Show/hide track')}>
          <Icon name="eye" size={14} />
        </button>
        <span className="tl-track-icon">
          <Icon name="animFolder" size={14} />
        </span>
        <button className="tl-track-name" onClick={() => anim.selectTrackFrame(track.id, frame)}>
          {track.name}
        </button>
      </div>
      <div className="tl-cells">{cells}</div>
    </div>
  );
}

export function TimelinePalette() {
  const timeline = useStore((s) => s.doc.timeline);
  const layers = useStore((s) => s.doc.layers);
  const { frame, playing, loop, onionSkin } = useStore(useShallow((s) => ({ frame: s.frame, playing: s.playing, loop: s.loop, onionSkin: s.onionSkin })));
  const activeId = useStore((s) => anim.activeTrack(s)?.id ?? null);
  const tracks = useMemo(() => animationFolders(layers), [layers]);
  const scrub = useRef(false);

  const enabled = Boolean(timeline?.enabled);
  const frames = timeline?.frames ?? 0;
  const frameFromEvent = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    return Math.floor((e.clientX - box.left) / CELL) + 1;
  };
  const active = tracks.find((t) => t.id === activeId) ?? null;

  return (
    <section className="timeline-palette" data-testid="timeline" aria-label="Timeline">
      <div className="timeline-bar">
        <span className="palette-title">Timeline</span>
        <Button icon="frameFirst" label="Go to start" disabled={!enabled} onClick={anim.firstFrame} />
        <Button icon="framePrev" label="Go to previous frame" disabled={!enabled} onClick={anim.previousFrame} />
        <Button icon={playing ? 'stop' : 'play'} label={playing ? 'Stop' : 'Play'} disabled={!enabled} onClick={anim.togglePlay} />
        <Button icon="frameNext" label="Go to next frame" disabled={!enabled} onClick={anim.nextFrame} />
        <Button icon="frameLast" label="Go to end" disabled={!enabled} onClick={anim.lastFrame} />
        <Button icon="loop" label="Loop play" on={loop} onClick={anim.toggleLoop} />
        <span className="sep" />
        <Button icon="newAnimFolder" label="New animation folder" onClick={() => void anim.newAnimationFolder()} />
        <Button icon="newCel" label="New animation cel" disabled={!enabled} onClick={() => void anim.newAnimationCel()} />
        <Button icon="newLayer" label="Assign cel to frame" disabled={!enabled || !active} onClick={openAssignMenu} />
        <Button icon="removeCel" label="Delete assigned cel" disabled={!enabled || !active} onClick={() => anim.removeAssignedCel()} />
        <span className="sep" />
        <Button icon="onion" label="Enable onion skin" on={onionSkin} disabled={!enabled} onClick={anim.toggleOnionSkin} />
        <span className="spacer" />
        {timeline && (
          <button className="tl-info" title="Animation > Timeline > Change settings" onClick={() => openDialog('timelineSettings')}>
            <span data-testid="timeline-frame">{frame}</span> / {frames} · {timeline.fps} fps{enabled ? '' : ' · off'}
          </button>
        )}
      </div>
      {!timeline ? (
        <div className="timeline-empty">This canvas has no timeline. New animation folder makes one (with a track); Animation &gt; Timeline &gt; New timeline sets its frame rate and length.</div>
      ) : (
        <div className={`timeline-body ${enabled ? '' : 'disabled'}`} style={{ ['--cell' as string]: `${CELL}px` }}>
          <div className="tl-row tl-head">
            <div className="tl-name">Frame</div>
            <div
              className="tl-cells tl-ruler"
              data-testid="timeline-ruler"
              onPointerDown={(e) => {
                scrub.current = true;
                e.currentTarget.setPointerCapture(e.pointerId);
                anim.setFrame(frameFromEvent(e));
              }}
              onPointerMove={(e) => {
                if (scrub.current) anim.setFrame(frameFromEvent(e));
              }}
              onPointerUp={() => (scrub.current = false)}
            >
              {Array.from({ length: frames }, (_, i) => (
                <div key={i} className={`tl-cell ${i + 1 === frame ? 'current' : ''}`}>
                  {i + 1}
                </div>
              ))}
            </div>
          </div>
          {tracks.length === 0 && <div className="timeline-empty">No animation folders yet: New animation folder adds a track.</div>}
          {tracks.map((t) => (
            <TrackRow key={t.id} track={t} frames={frames} frame={frame} active={t.id === activeId} />
          ))}
        </div>
      )}
    </section>
  );
}
