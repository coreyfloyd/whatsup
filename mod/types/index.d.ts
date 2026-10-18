declare module 'claude-code' {
  interface PluginState {
    'whatsup': {
      /** The key of the item whose card is shown, or null: one card at a time. */
      openCard: string | null
      reportViews: Record<string, { shown: string | null; expanded: number[] }>
    }
  }
}
