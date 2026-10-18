export const colors = {
  paper: '#F7F3EC',
  card: '#FFFDF9',
  ink: '#1F1B16',
  muted: '#7A7066',
  faint: '#B8AEA2',
  line: '#E6DED2',
  seal: '#B3261E', // vermilion, like a seal stamp
  sealSoft: '#F6E3DF',
  ok: '#2F6B4F',
};

export function formatTime(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export function formatDate(ms: number) {
  const d = new Date(ms);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
