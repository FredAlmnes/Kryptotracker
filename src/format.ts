export const usd = (n: number, digits = 2) =>
  `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`
export const signedUsd = (n: number) => `${n > 0 ? '+' : ''}${usd(n)}`
export const pct = (n: number, digits = 1) => `${n > 0 ? '+' : ''}${(n * 100).toFixed(digits)}%`
export const price = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: n < 10 ? 4 : 2 })
export const dateTime = (ms: number) =>
  new Date(ms).toLocaleString('nb-NO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
