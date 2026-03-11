type IconName =
  | 'overview'
  | 'codex'
  | 'opencode'
  | 'theme'
  | 'back'
  | 'plus'
  | 'refresh'
  | 'check'
  | 'trash'
  | 'spark'
  | 'chevron'
  | 'edit'
  | 'close'
  | 'sun'
  | 'moon'

const paths: Record<IconName, string[]> = {
  overview: ['M5 12h14M5 6h14M5 18h8'],
  codex: ['M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z'],
  opencode: ['M4 6h16M4 12h16M4 18h7'],
  theme: ['M12 3v1m0 16v1m8-9h1M3 12H2m15.364 6.364.707.707M5.929 5.929l-.707-.707m12.142 0-.707.707M5.929 18.071l-.707.707', 'M15 12a3 3 0 11-6 0 3 3 0 016 0z'],
  back: ['M10 19l-7-7m0 0 7-7m-7 7h18'],
  plus: ['M12 4v16m8-8H4'],
  refresh: ['M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15'],
  check: ['M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z'],
  trash: ['M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16'],
  spark: ['M12 3l1.2 4.1L17 8.3l-3.8 1.1L12 13.5l-1.2-4.1L7 8.3l3.8-1.2L12 3zm6 12l.6 2.1 2 .6-2 .6-.6 2.1-.6-2.1-2-.6 2-.6.6-2.1zM6 14l.8 2.6L9.4 17l-2.6.8L6 20.4l-.8-2.6L2.6 17l2.6-.4L6 14z'],
  chevron: ['M19 9l-7 7-7-7'],
  edit: ['M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z'],
  close: ['M6 18L18 6M6 6l12 12'],
  sun: ['M12 3v1m0 16v1m8-9h1M3 12H2m15.364 6.364.707.707M5.929 5.929l-.707-.707m12.142 0-.707.707M5.929 18.071l-.707.707', 'M15 12a3 3 0 11-6 0 3 3 0 016 0z'],
  moon: ['M21 12.79A9 9 0 1111.21 3c0 .11 0 .22.01.33A7 7 0 0020.67 12c.12 0 .22 0 .33-.01z'],
}

export function InlineIcon({
  name,
  className = 'w-4 h-4',
  strokeWidth = 1.6,
}: {
  name: IconName
  className?: string
  strokeWidth?: number
}) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      {paths[name].map((path, index) => (
        <path key={`${name}-${index}`} strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} d={path} />
      ))}
    </svg>
  )
}
