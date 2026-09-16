/**
 * One icon set, drawn on a 24-unit grid with a 1.7-unit stroke.
 *
 * Nothing in the UI is allowed to use an emoji or a box-drawing glyph for an icon: they
 * render differently on every OS, cannot inherit the accent colour, and undercut the
 * precision the solver is selling. If an icon is missing, add it here rather than reaching
 * for a character.
 */

export type IconName = keyof typeof PATHS

const PATHS = {
  // rail & navigation
  layers: 'M12 3 2 8l10 5 10-5-10-5Zm-10 9 10 5 10-5M2 17l10 5 10-5',
  projects: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  prefs: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1l2-1.5-2-3.4-2.3 1a7.3 7.3 0 0 0-1.7-1L15 3.7H9l-.3 2.4a7.3 7.3 0 0 0-1.7 1l-2.3-1-2 3.4L4.7 11a7.4 7.4 0 0 0 0 2l-2 1.5 2 3.4 2.3-1a7.3 7.3 0 0 0 1.7 1l.3 2.4h6l.3-2.4a7.3 7.3 0 0 0 1.7-1l2.3 1 2-3.4-2-1.5c.1-.3.1-.7.1-1Z',
  help: 'M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z',
  inspect: 'M4 6h16M4 12h10M4 18h6M17 15l3 3-3 3',

  // tools & plan objects
  select: 'M5 3l14 8-6 2-3 6z',
  wall: 'M3 10h18v4H3z',
  door: 'M4 20V5h10v15M14 5a8 8 0 0 1 6 8M4 20h16',
  window: 'M4 5h16v14H4zM12 5v14M4 12h16',
  furniture: 'M4 11V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3M3 11h18v6H3zM5 17v3M19 17v3',
  furnitureSmall: 'M4 11V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3M3 11h18v6H3z',
  room: 'M4 5h16v14H4zM4 12h9',
  corner: 'M5 19V5h14',
  hand: 'M8 13V5a1.5 1.5 0 0 1 3 0v6m0-7a1.5 1.5 0 0 1 3 0v7m0-5a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-3l-3-5a1.5 1.5 0 0 1 2.5-1.6L8 13',
  comment: 'M21 12a8 8 0 0 1-8 8H8l-5 3 1.5-4.5A8 8 0 1 1 21 12Z',

  // rules
  parallel: 'M8 4v16M16 4v16',
  perpendicular: 'M5 4v15h15',
  horizontal: 'M3 12h18M6 9v6M18 9v6',
  vertical: 'M12 3v18M9 6h6M9 18h6',
  equal: 'M5 9h14M5 15h14',
  angle: 'M5 19h14M5 19 16 6M9 19a5 5 0 0 0 1.6-3.6',
  dimension: 'M3 12h18M3 8v8M21 8v8',
  /** three ticks on a line: the density of measurements shown, not a single dimension */
  density: 'M3 12h18M7 8v8M12 8v8M17 8v8',
  anchor: 'M12 8v12M12 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5M5 13a7 7 0 0 0 14 0',

  // actions
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  close: 'M6 6l12 12M18 6 6 18',
  check: 'M4 12.5 9.5 18 20 6.5',
  rename: 'M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3ZM14.5 7.5l2 2',
  duplicate: 'M9 9h11v11H9zM5 15H4V4h11v1',
  trash: 'M4 7h16M10 7V5h4v2M6 7l1 13h10l1-13M10 11v6M14 11v6',
  undo: 'M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
  redo: 'm15 14 5-5-5-5M20 9H9a5 5 0 0 0 0 10h3',
  rotate: 'M20 12a8 8 0 1 1-2.6-5.9M20 4v5h-5',
  flipH: 'M12 4v16M8 8 4 12l4 4M16 8l4 4-4 4',
  flipV: 'M4 12h16M8 8l4-4 4 4M8 16l4 4 4-4',
  share: 'M17 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM7 15a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm10 6a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM9.2 11.3l5.6-2.6m0 6.6-5.6-2.6',
  download: 'M12 3v12m0 0 4-4m-4 4-4-4M4 19h16',
  upload: 'M12 15V3m0 0 4 4m-4-4L8 7M4 19h16',
  eye: 'M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Zm10 2.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  chevronRight: 'm9 5 7 7-7 7',
  chevronDown: 'm5 9 7 7 7-7',
  /** the fit-to-view corners; "dimension" used to stand in for it and read as "show dimensions" */
  fit: 'M4 9V4h5M20 15v5h-5M4 15v5h5M20 9V4h-5',

  // export formats
  filePdf: 'M6 2h8l4 4v16H6zM14 2v5h5',
  fileImage: 'M3 4h18v16H3zM5 17l5-5 4 4 2-2 3 3',
  fileModel: 'M12 2 3 7v10l9 5 9-5V7zM3 7l9 5 9-5M12 12v10',
  fileProject: 'M4 7h16v12H4zM4 7l2-3h5l2 3',
} as const

/** the lock is two shapes rather than one path, so it gets its own component */
export function LockIcon({ size = 14, open = false, strokeWidth = 2, className }: { size?: number; open?: boolean; strokeWidth?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x={4} y={11} width={16} height={10} rx={2} />
      <path d={open ? 'M8 11V7a4 4 0 0 1 7.5-2' : 'M8 11V7a4 4 0 0 1 8 0v4'} />
    </svg>
  )
}

export function WarningIcon({ size = 14, strokeWidth = 2.2, className }: { size?: number; strokeWidth?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.3 3.9 2.6 17.4A2 2 0 0 0 4.3 20.4h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      <path d="M12 8v5M12 17h.01" />
    </svg>
  )
}

export function Icon({ name, size = 16, strokeWidth = 1.7, className, title }: { name: IconName; size?: number; strokeWidth?: number; className?: string; title?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      {title && <title>{title}</title>}
      <path d={PATHS[name]} />
    </svg>
  )
}
