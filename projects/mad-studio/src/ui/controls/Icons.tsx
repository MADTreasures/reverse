import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 14, children, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...rest}>
      {children}
    </svg>
  );
}

export const IconPlay = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.5 3v10l8-5z" fill="currentColor" stroke="none" />
  </Svg>
);
export const IconPause = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="3" width="3" height="10" fill="currentColor" stroke="none" />
    <rect x="9" y="3" width="3" height="10" fill="currentColor" stroke="none" />
  </Svg>
);
export const IconStop = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="4" width="8" height="8" fill="currentColor" stroke="none" />
  </Svg>
);
export const IconRecord = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="4.5" fill="currentColor" stroke="none" />
  </Svg>
);
export const IconMetronome = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5.5 14h5L9 2.5H7z" />
    <path d="M8 10l4-6" />
  </Svg>
);
export const IconPlaylist = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2" y="3" width="6" height="3" rx="0.5" />
    <rect x="6" y="7" width="8" height="3" rx="0.5" />
    <rect x="3" y="11" width="5" height="3" rx="0.5" />
  </Svg>
);
export const IconRack = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2" y="3" width="12" height="2.5" rx="0.5" />
    <rect x="2" y="6.75" width="12" height="2.5" rx="0.5" />
    <rect x="2" y="10.5" width="12" height="2.5" rx="0.5" />
  </Svg>
);
export const IconPiano = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2" y="2.5" width="12" height="11" rx="1" />
    <path d="M5 2.5v6M8 2.5v11M11 2.5v6" />
  </Svg>
);
export const IconMixer = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 2v12M8 2v12M12 2v12" />
    <rect x="2.5" y="9" width="3" height="2" fill="currentColor" />
    <rect x="6.5" y="5" width="3" height="2" fill="currentColor" />
    <rect x="10.5" y="10" width="3" height="2" fill="currentColor" />
  </Svg>
);
export const IconBrowser = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2 4.5h4l1.5 1.5H14v7H2z" />
  </Svg>
);
export const IconClose = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Svg>
);
export const IconMaximize = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="3" width="10" height="10" rx="1" />
  </Svg>
);
export const IconPlus = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 3v10M3 8h10" />
  </Svg>
);
export const IconChevronLeft = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 3L5 8l5 5" />
  </Svg>
);
export const IconChevronRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 3l5 5-5 5" />
  </Svg>
);
export const IconChevronDown = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 6l4.5 4.5L12.5 6" />
  </Svg>
);
export const IconPencil = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10.5 2.5l3 3-8 8H2.5v-3z" />
  </Svg>
);
export const IconBrush = (p: IconProps) => (
  <Svg {...p}>
    <path d="M13.5 2.5l-6 6" />
    <path d="M7.5 8.5c-2 0-3 1.5-3 3 0 1-.7 1.6-2 2 3 1 6 0 6.5-2.5z" />
  </Svg>
);
export const IconEraser = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 13.5h8M2.8 9.7l6.5-6.5 3.5 3.5-6.5 6.5H5z" />
  </Svg>
);
/** Slice tool: a knife. */
export const IconSlice = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 13l7.5-7.5M10.5 5.5l2-2 1 1-2 2zM8 2.5v4M8 9.5v4" />
  </Svg>
);
/** Mute tool: a speaker with a cross. */
export const IconMute = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 6.2h2.4L8 3.4v9.2L4.9 9.8H2.5z" />
    <path d="M10.4 6.2l3.4 3.6M13.8 6.2l-3.4 3.6" />
  </Svg>
);
export const IconSelect = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.5" y="2.5" width="11" height="11" strokeDasharray="2 2" />
  </Svg>
);
export const IconMagnet = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 2.5v5.5a4 4 0 008 0V2.5" />
    <path d="M4 5h2.5M9.5 5H12" />
  </Svg>
);
export const IconWave = (p: IconProps) => (
  <Svg {...p}>
    <path d="M1.5 8h2l1.5-4 2 8 2-10 2 9 1.5-3h2" />
  </Svg>
);
export const IconSpeaker = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 6h2.5l3.5-3v10L5 10H2.5z" />
    <path d="M11 5.5a3.5 3.5 0 010 5" />
  </Svg>
);
export const IconUndo = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 4L2 7l3 3" />
    <path d="M2.5 7H10a3.5 3.5 0 010 7H7" />
  </Svg>
);
export const IconRedo = (p: IconProps) => (
  <Svg {...p}>
    <path d="M11 4l3 3-3 3" />
    <path d="M13.5 7H6a3.5 3.5 0 000 7h3" />
  </Svg>
);
export const IconSave = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 2.5h8l2.5 2.5v8.5h-11z" />
    <path d="M5 2.5v3.5h5V2.5M5 13.5v-4h6v4" />
  </Svg>
);
export const IconKeyboard = (p: IconProps) => (
  <Svg {...p}>
    <rect x="1.5" y="4" width="13" height="8" rx="1" />
    <path d="M4 6.5h.01M6.5 6.5h.01M9 6.5h.01M11.5 6.5h.01M4.5 9.5h7" />
  </Svg>
);
export const IconGhost = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 14V7a4.5 4.5 0 019 0v7l-1.5-1.2L9.5 14 8 12.8 6.5 14 5 12.8z" />
  </Svg>
);
/** Automation clip: two points joined by a rising line (our own glyph). */
export const IconCurve = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 12.5 C6 12.5 7 4 13 3.5" />
    <circle cx="3" cy="12.5" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="13" cy="3.5" r="1.6" fill="currentColor" stroke="none" />
  </Svg>
);
export const IconMic = (p: IconProps) => (
  <Svg {...p}>
    <rect x="6" y="2" width="4" height="8" rx="2" />
    <path d="M3.5 8a4.5 4.5 0 0 0 9 0M8 12.5V14" />
  </Svg>
);
export const IconPlug = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 2v3M10 2v3M4.5 5h7v2.5a3.5 3.5 0 0 1-7 0zM8 11v3" />
  </Svg>
);
/** Recording precount: a small counting-down metronome tick. */
export const IconPrecount = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 12h2M7 12h2M11.5 12h2" strokeWidth={2.2} />
    <path d="M8 3v5l2.5 1.5" />
  </Svg>
);
/** Plugin delay compensation (FL Studio's mixer delay panel): a clock. */
export const IconClock = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="5.75" />
    <path d="M8 4.75V8l2.25 1.5" />
  </Svg>
);
/** Piano roll tools menu: a wrench. */
export const IconTools = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10.5 2.5a3 3 0 0 0-2.8 4.1L2.8 11.5a1.2 1.2 0 0 0 1.7 1.7l4.9-4.9a3 3 0 0 0 4.1-2.8l-1.7 1.2-1.6-1.6 1.2-1.7a3 3 0 0 0-.9-.4z" />
  </Svg>
);
/** Stamp (chords and scales in one click). */
export const IconStamp = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6.5 2.5h3v3.2l2.5 1.8v2h-8v-2l2.5-1.8zM3 12.5h10" />
  </Svg>
);
/** Scale highlighting: a stack of keys with a marker. */
export const IconScale = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 3h10M3 6.3h10M3 9.6h10M3 13h10" strokeOpacity={0.45} />
    <circle cx="5" cy="3" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="9" cy="6.3" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="6.5" cy="9.6" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="11" cy="13" r="1.3" fill="currentColor" stroke="none" />
  </Svg>
);
/** Graph editor: bars of step values. */
export const IconGraph = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 13V8M6.5 13V4M10 13V9.5M13.5 13V6" strokeWidth={2} />
  </Svg>
);
