import type { Worker } from './report'

// Shared palette for terminal lines and Desktop native boxes.
export const CHOSEN = {
  text: '#d8d8d8', muted: '#a0a0a0', faint: '#5e5e5e', grey: '#808080', ink: '#1a1a1a',
  session: '#9fd3e8', sessionTint: '#1f2a30', success: '#7ddc8a', warning: '#ffcf5a',
  agents: '#f2b84b', decision: '#ff7b86', badgeBackground: '#3a3a3a',
}
export const DONE_GRADIENT = ['#5fbf74', '#c4f2b8']
export const SECTION_STYLES = [
  { accent: '#6ad4a8', tint: '#1b2e27', gradient: ['#2fa87a', '#b8f0d8'] },
  { accent: '#5aa9ff', tint: '#1c2636', gradient: ['#2f7fe0', '#b8d6ff'] },
  { accent: '#b6e05a', tint: '#262e1c', gradient: ['#86b832', '#e2f5b8'] },
  { accent: '#58c8d8', tint: '#1b2c30', gradient: ['#2ea2b5', '#b8ecf3'] },
]
const WORKER_STYLES = {
  running: { accent: CHOSEN.agents, tint: '#302a1a' },
  waiting: { accent: '#ececec', tint: undefined },
  failed: { accent: CHOSEN.decision, tint: '#33222a' },
  done: { accent: CHOSEN.grey, tint: undefined },
}
export function gradient(from: string, to: string, index: number, length: number): string {
  const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
  const a = rgb(from), b = rgb(to), fraction = length > 1 ? index / (length - 1) : 0
  return '#' + a.map((v, i) => Math.round(v + (b[i]! - v) * fraction).toString(16).padStart(2, '0')).join('')
}
export function workerStyle(state: Worker['state']) {
  return WORKER_STYLES[state]
}
