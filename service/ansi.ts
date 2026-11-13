// Escape sequences in server output (dev servers run with FORCE_COLOR=1): CSI codes such as colours, and
// OSC sequences such as terminal titles and hyperlinks, which can wrap a URL or a port number.
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

export const stripAnsi = (s: string): string => s.replace(ANSI, '');
