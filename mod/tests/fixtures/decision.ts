/** Illustrated product input from the approved selected layout; not observed work. */
export const decision = {
  identity: 'expansion', question: 'Keep multiple decisions expanded?',
  why_now: 'Several questions may be pending at once. Long cards can push session progress out of view.',
  context: 'Expanded cards show context and answer options. Collapsed cards keep only the question. Asking for more context leaves the decision pending.',
  options: [
    { identity: 'one', label: 'Expand one at a time', benefit: 'Opening a decision collapses the previous one. Less scrolling.', cost: 'Comparing questions needs a click.' },
    { identity: 'several', label: 'Keep several open', benefit: 'Compare expanded questions in the list.', cost: 'More scrolling; progress may move below the view.' },
  ],
  recommendation: { option: 'one', reason: 'Keep the current question readable and other questions easy to find.' },
}
