/** Own line icons (20 × 20), drawn for MAD Studio Paint. */
import type { ReactNode } from 'react';

const paths: Record<string, ReactNode> = {
  zoom: (
    <>
      <circle cx="8.5" cy="8.5" r="5" />
      <path d="M12.2 12.2 17 17" />
    </>
  ),
  hand: <path d="M6 10V5.5a1.2 1.2 0 0 1 2.4 0V9m0-4.5V3.8a1.2 1.2 0 0 1 2.4 0V9m0-4.2a1.2 1.2 0 0 1 2.4 0V9.5m0-3a1.2 1.2 0 0 1 2.4 0v5.2c0 3.2-2 5.3-5 5.3-2.2 0-3.4-1-4.6-2.8L3.7 11a1.2 1.2 0 0 1 2-1.3L6 10" />,
  rotate: (
    <>
      <path d="M15.5 9.5a5.6 5.6 0 1 1-1.7-4" />
      <path d="M14.5 2.5v3.2h-3.2" />
    </>
  ),
  move: <path d="M10 2v16M2 10h16M10 2 7.8 4.2M10 2l2.2 2.2M10 18l-2.2-2.2M10 18l2.2-2.2M2 10l2.2-2.2M2 10l2.2 2.2M18 10l-2.2-2.2M18 10l-2.2 2.2" />,
  select: <rect x="3.5" y="4.5" width="13" height="11" strokeDasharray="2.2 1.8" />,
  operation: (
    <>
      <path d="M4 3l9.5 5.5-4.2 1.1 2.6 4.6-1.9 1.1-2.6-4.6-3.4 3z" />
      <rect x="12.5" y="12.5" width="5" height="5" strokeDasharray="1.5 1.2" />
    </>
  ),
  selectLayer: (
    <>
      <path d="M3 3l8.5 5-3.8 1 2.3 4.1-1.7 1-2.3-4.1-3 2.7z" />
      <path d="M11 13.5h6.5M11 16.5h6.5M14 10.5h3.5" />
    </>
  ),
  autoSelect: (
    <>
      <path d="m3 17 9-9" />
      <path d="m12.5 3.5.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6zM16 8.5l.4 1 1 .4-1 .4-.4 1-.4-1-1-.4 1-.4z" />
    </>
  ),
  eyedropper: (
    <>
      <path d="m11.5 5.5 3 3-7.6 7.6H3.9v-3z" />
      <path d="m10.8 4.8 1.6-1.6a1.9 1.9 0 0 1 2.7 0l1.7 1.7a1.9 1.9 0 0 1 0 2.7l-1.6 1.6" />
    </>
  ),
  pen: (
    <>
      <path d="M4 16.5 5.3 12 13.5 3.8l2.7 2.7L8 14.7z" />
      <path d="m4 16.5 2.3-2.3M11.8 5.5l2.7 2.7" />
    </>
  ),
  pencil: (
    <>
      <path d="m13.2 3.3 3.5 3.5L7.5 16 3.4 17l1-4.2z" />
      <path d="m11.6 4.9 3.5 3.5M4.4 12.8l2.8 2.8" />
    </>
  ),
  brush: (
    <>
      <path d="M17 3c-2.5 1-6.6 4.7-8.4 7.3l1.1 1.1C12.3 9.6 16 5.5 17 3z" />
      <path d="M8.2 11.2c-1.9 0-3.1 1.2-3.3 3-.2 1.3-.7 2-1.9 2.3 2.8 1 6.6.2 6.8-3.3z" />
    </>
  ),
  airbrush: (
    <>
      <rect x="7" y="7" width="7" height="10.5" rx="1.5" />
      <path d="M8.5 7V5h4v2M10.5 5V3.5" />
      <path d="M4.5 3.5h.01M3 6h.01M5 6.5h.01M3.5 9h.01" strokeWidth="1.8" strokeLinecap="round" />
    </>
  ),
  eraser: (
    <>
      <path d="m8.4 16.5-4.6-4.6a1.4 1.4 0 0 1 0-2l6.4-6.4a1.4 1.4 0 0 1 2 0l4.6 4.6a1.4 1.4 0 0 1 0 2l-6.4 6.4z" />
      <path d="m6.2 7.6 6.6 6.6M8.4 16.5H17" />
    </>
  ),
  blend: (
    <>
      <path d="M10 2.5s-5 5.4-5 9a5 5 0 0 0 10 0c0-3.6-5-9-5-9z" />
      <path d="M7.6 12a2.5 2.5 0 0 0 2.4 2.5" />
    </>
  ),
  fill: (
    <>
      <path d="m9 3 6.5 6.5-6 6a1.5 1.5 0 0 1-2.1 0L3 11.1a1.5 1.5 0 0 1 0-2.1z" />
      <path d="M3.4 9.6h11.7M16.5 12.5s1.5 1.8 1.5 2.8a1.5 1.5 0 0 1-3 0c0-1 1.5-2.8 1.5-2.8z" />
    </>
  ),
  gradient: (
    <>
      <rect x="3" y="3" width="14" height="14" rx="1.5" />
      <path d="M6 3v14M9 3v14M12.5 3v14" strokeDasharray="1 1.4" />
    </>
  ),
  figure: (
    <>
      <rect x="2.5" y="9" width="7.5" height="7.5" />
      <circle cx="13" cy="7" r="4.5" />
    </>
  ),
  new: (
    <>
      <path d="M5 2.5h6.5L15.5 6.5V17.5H5z" />
      <path d="M11.5 2.5v4h4M10.2 9v6M7.2 12h6" />
    </>
  ),
  open: <path d="M2.5 15.5V5a1 1 0 0 1 1-1h4l1.5 1.8h6.5a1 1 0 0 1 1 1V8M2.5 15.5 5 8.5h13l-2.5 7z" />,
  save: (
    <>
      <path d="M4 3h10l2.5 2.5V17H4z" />
      <path d="M7 3v4h6V3M6.5 17v-5.5h7V17" />
    </>
  ),
  undo: <path d="M7.5 5.5 4 9l3.5 3.5M4 9h8a4 4 0 0 1 0 8H9" />,
  redo: <path d="M12.5 5.5 16 9l-3.5 3.5M16 9H8a4 4 0 0 0 0 8h3" />,
  clear: (
    <>
      <rect x="3.5" y="3.5" width="13" height="13" strokeDasharray="2 1.6" />
      <path d="m7.2 7.2 5.6 5.6M12.8 7.2l-5.6 5.6" />
    </>
  ),
  clearOutside: (
    <>
      <rect x="2.5" y="2.5" width="15" height="15" />
      <rect x="6.5" y="6.5" width="7" height="7" strokeDasharray="1.8 1.4" />
    </>
  ),
  transform: (
    <>
      <rect x="4" y="4" width="12" height="12" strokeDasharray="2 1.6" />
      <path d="M2.5 2.5h3v3h-3zM14.5 2.5h3v3h-3zM2.5 14.5h3v3h-3zM14.5 14.5h3v3h-3z" />
    </>
  ),
  deselect: (
    <>
      <rect x="3.5" y="3.5" width="13" height="13" strokeDasharray="2 1.6" />
      <path d="M7 10h6" />
    </>
  ),
  invertSelection: (
    <>
      <rect x="3" y="3" width="14" height="14" />
      <path d="M3 17 17 3" />
      <path d="M3 3l3 0M3 3v3" />
    </>
  ),
  fillCommand: (
    <>
      <rect x="3.5" y="3.5" width="13" height="13" strokeDasharray="2 1.6" />
      <rect x="6.5" y="6.5" width="7" height="7" fill="currentColor" />
    </>
  ),
  eye: (
    <>
      <path d="M1.8 10s3-5.5 8.2-5.5S18.2 10 18.2 10s-3 5.5-8.2 5.5S1.8 10 1.8 10z" />
      <circle cx="10" cy="10" r="2.5" />
    </>
  ),
  lock: (
    <>
      <rect x="4.5" y="9" width="11" height="8" rx="1" />
      <path d="M7 9V6.5a3 3 0 0 1 6 0V9" />
    </>
  ),
  lockAlpha: (
    <>
      <rect x="3" y="3" width="14" height="14" />
      <path d="M3 10h14M10 3v14" />
      <rect x="3" y="3" width="7" height="7" fill="currentColor" />
      <rect x="10" y="10" width="7" height="7" fill="currentColor" />
    </>
  ),
  clip: (
    <>
      <rect x="2.5" y="10" width="15" height="7" />
      <path d="M6 10V4.5h11.5V10M3.5 6.5 6 4.5" />
    </>
  ),
  reference: (
    <>
      <circle cx="10" cy="10" r="7" />
      <circle cx="10" cy="10" r="3" />
      <circle cx="10" cy="10" r="0.6" fill="currentColor" />
    </>
  ),
  draft: (
    <>
      <path d="M3 6c2-1.5 3.5-1.5 5 0s3 1.5 5 0 2.6-1 4-.5" />
      <path d="M3 10c2-1.5 3.5-1.5 5 0s3 1.5 5 0 2.6-1 4-.5" />
      <path d="M3 14c2-1.5 3.5-1.5 5 0s3 1.5 5 0 2.6-1 4-.5" />
    </>
  ),
  newLayer: (
    <>
      <rect x="3" y="5" width="12" height="12" rx="1" />
      <path d="M15.5 1.5v6M12.5 4.5h6" />
    </>
  ),
  newFolder: (
    <>
      <path d="M2.5 16V5.5a1 1 0 0 1 1-1h4l1.5 1.8h7.5a1 1 0 0 1 1 1V16z" />
      <path d="M10 8.5v5M7.5 11h5" />
    </>
  ),
  folder: <path d="M2.5 16V5.5a1 1 0 0 1 1-1h4l1.5 1.8h7.5a1 1 0 0 1 1 1V16z" />,
  mask: (
    <>
      <rect x="2.5" y="4" width="15" height="12" rx="1" />
      <circle cx="10" cy="10" r="3.6" />
      <path d="M2.5 4 6.4 7.5M17.5 4l-3.9 3.5M2.5 16l3.9-3.5M17.5 16l-3.9-3.5" />
    </>
  ),
  check: <path d="m5 10.5 3.2 3.2L15 7" />,
  link: <path d="M8.5 11.5a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2l-.8.8M11.5 8.5a3 3 0 0 0-4.2 0l-2.6 2.6a3 3 0 0 0 4.2 4.2l.8-.8" />,
  trash: (
    <>
      <path d="M4 5.5h12M8 5.5V3.5h4v2M5.5 5.5l.8 11h7.4l.8-11" />
      <path d="M8.5 8.5v5.5M11.5 8.5v5.5" />
    </>
  ),
  mergeDown: (
    <>
      <rect x="3" y="12" width="14" height="5" />
      <path d="M10 2.5v7M7 6.5l3 3 3-3" />
    </>
  ),
  duplicate: (
    <>
      <rect x="6.5" y="6.5" width="10.5" height="10.5" rx="1" />
      <path d="M13.5 6.5V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v8.5a1 1 0 0 0 1 1h2.5" />
    </>
  ),
  chevronRight: <path d="m8 5 5 5-5 5" />,
  chevronDown: <path d="m5 8 5 5 5-5" />,
  zoomIn: (
    <>
      <circle cx="8.5" cy="8.5" r="5" />
      <path d="M12.2 12.2 17 17M6.3 8.5h4.4M8.5 6.3v4.4" />
    </>
  ),
  zoomOut: (
    <>
      <circle cx="8.5" cy="8.5" r="5" />
      <path d="M12.2 12.2 17 17M6.3 8.5h4.4" />
    </>
  ),
  fit: <path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4M6.5 6.5h7v7h-7z" />,
  actual: (
    <>
      <rect x="3" y="3" width="14" height="14" rx="1.5" />
      <path d="M7 7.5 8.5 6.5v7M11.2 13.5V6.5h1.6c1.2 0 1.7.7 1.7 1.6v3.8c0 .9-.5 1.6-1.7 1.6z" />
    </>
  ),
  flipH: <path d="M10 2v16M8 5 3 15h5zM12 5l5 10h-5z" />,
  flipV: <path d="M2 10h16M5 8 15 3v5zM5 12l10 5v-5z" />,
  rotateLeft: (
    <>
      <path d="M4.5 10.5a5.5 5.5 0 1 0 2-4.3" />
      <path d="M6.8 2.8 6.4 6.3 9.9 6.6" />
    </>
  ),
  rotateRight: (
    <>
      <path d="M15.5 10.5a5.5 5.5 0 1 1-2-4.3" />
      <path d="m13.2 2.8.4 3.5-3.5.3" />
    </>
  ),
  launcher: <path d="M3 10h14M10 3v14" />,
  crop: <path d="M5.5 2v12.5H18M2 5.5h12.5V18" />,
  copyPaste: (
    <>
      <rect x="6.5" y="6.5" width="10.5" height="10.5" rx="1" strokeDasharray="2 1.5" />
      <path d="M13.5 6.5V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v8.5a1 1 0 0 0 1 1h2.5" />
    </>
  ),
  cutPaste: (
    <>
      <circle cx="5.5" cy="14.5" r="2.5" />
      <circle cx="14.5" cy="14.5" r="2.5" />
      <path d="M7.3 12.7 15 3M12.7 12.7 5 3" />
    </>
  ),
  expand: (
    <>
      <rect x="6" y="6" width="8" height="8" strokeDasharray="1.8 1.4" />
      <path d="M2.5 2.5 5 5M17.5 2.5 15 5M2.5 17.5 5 15M17.5 17.5 15 15" />
    </>
  ),
  shrink: (
    <>
      <rect x="2.5" y="2.5" width="15" height="15" strokeDasharray="1.8 1.4" />
      <path d="m6 6 2.5 2.5M14 6l-2.5 2.5M6 14l2.5-2.5M14 14l-2.5-2.5" />
    </>
  ),
  border: (
    <>
      <rect x="3.5" y="3.5" width="13" height="13" strokeDasharray="2 1.6" />
      <circle cx="10" cy="10" r="2" />
    </>
  ),
  help: (
    <>
      <circle cx="10" cy="10" r="7.5" />
      <path d="M7.8 7.8a2.3 2.3 0 1 1 3.3 2.1c-.7.3-1.1.9-1.1 1.6v.6M10 14.6v.1" />
    </>
  ),
  transferDown: (
    <>
      <rect x="3" y="12" width="14" height="5" />
      <rect x="3" y="3" width="14" height="5" strokeDasharray="1.8 1.4" />
      <path d="M10 6.5v4M8.2 8.8 10 10.6l1.8-1.8" />
    </>
  ),
  page: <path d="M5.5 2.5h6l3 3v12h-9zM11.5 2.5v3h3" />,
  resetRotation: (
    <>
      <path d="M4.5 10a5.5 5.5 0 1 0 1.6-3.9" />
      <path d="M5.5 2.8v3.5H9" />
      <path d="M10 7v3l2 1.3" />
    </>
  ),
  swap: <path d="M5 8V5.5a1 1 0 0 1 1-1h7.5M11.5 2.5l2 2-2 2M15 12v2.5a1 1 0 0 1-1 1H6.5M8.5 17.5l-2-2 2-2" />,
  wrench: <path d="M12.4 3.2a4 4 0 0 0-4.9 5.2L3.2 12.7a1.6 1.6 0 0 0 2.3 2.3l4.3-4.3a4 4 0 0 0 5.2-4.9l-2.3 2.3-2-.4-.4-2z" />,
  pressure: (
    <>
      <path d="M4 16c3 0 5.5-3 7-6.5S14 3 16 3" />
      <path d="M3 17h14" />
    </>
  ),
};

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] ?? <circle cx="10" cy="10" r="6" />}
    </svg>
  );
}
