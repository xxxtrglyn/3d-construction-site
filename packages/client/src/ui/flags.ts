/** 12 distinguishable crew flags (flag = plot index): color + symbol, no text needed. */
export const FLAGS: ReadonlyArray<{ color: string; symbol: string; name: string }> = [
  { color: '#eb4747', symbol: '★', name: 'Red Star' },
  { color: '#ff7a1f', symbol: '▲', name: 'Orange Peak' },
  { color: '#ffcc2e', symbol: '●', name: 'Sun' },
  { color: '#8ce04d', symbol: '♣', name: 'Clover' },
  { color: '#38a8b3', symbol: '◆', name: 'Teal Gem' },
  { color: '#3d7be0', symbol: '⚑', name: 'Blue Flag' },
  { color: '#9e73e6', symbol: '✿', name: 'Violet' },
  { color: '#ff8cb8', symbol: '♥', name: 'Heart' },
  { color: '#8a5a3c', symbol: '■', name: 'Brick' },
  { color: '#f7f7f7', symbol: '☁', name: 'Cloud' },
  { color: '#2a2a33', symbol: '☾', name: 'Moon' },
  { color: '#e6a514', symbol: '♛', name: 'Crown' },
];

export function flagHtml(i: number, size = 18): string {
  const f = FLAGS[i];
  if (!f) return '';
  const fg = i === 9 || i === 2 ? '#2a1a1a' : '#fff';
  return `<span class="flag" title="${f.name}" style="width:${size}px;height:${size}px;background:${f.color};color:${fg};font-size:${Math.round(size * 0.7)}px">${f.symbol}</span>`;
}
