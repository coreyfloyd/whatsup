// Role colors for the chosen pane design.
export const CHOSEN = { text: '#d8d8d8', muted: '#a0a0a0', faint: '#5e5e5e', grey: '#808080', ink: '#1a1a1a', session: '#f2c79b', success: '#7ddc8a', warning: '#ffcf5a', agents: '#7fe0c8' }
export const SECTION_STYLES = [
  { accent: '#ffab91', tint: '#30261f', gradient: ['#e0805c', '#ffd2bf'] },
  { accent: '#c9a7ff', tint: '#2b2537', gradient: ['#9d86e0', '#e2cbff'] },
  { accent: '#8ecbff', tint: '#1f2a35', gradient: ['#5fa8e8', '#c4e6ff'] },
  { accent: '#ff9ecb', tint: '#33232c', gradient: ['#e87fb0', '#ffd0e4'] },
]
export function gradient(from: string, to: string, index: number, length: number): string {
  const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
  const a = rgb(from), b = rgb(to), fraction = length > 1 ? index / (length - 1) : 0
  return '#' + a.map((v, i) => Math.round(v + (b[i]! - v) * fraction).toString(16).padStart(2, '0')).join('')
}
export function workerStyle(role: string, main: boolean) {
  return main || role === 'main' || role.startsWith('test') ? { accent: '#7fe0c8', tint: '#1e302b' }
    : role.startsWith('eval-web') || role.startsWith('gen-web') ? { accent: '#9fe3f0', tint: '#1e2d31' }
    : { accent: '#a8b4ff', tint: '#23263a' }
}
