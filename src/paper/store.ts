import { useSyncExternalStore } from 'react'
import type { PaperSettings, PaperState } from './types'

// Papirkontoen lagres i nettleseren. Flere faner holdes i synk via storage-eventet.
const KEY = 'kt-paper-v1'
const LAST_SEEN_KEY = 'kt-paper-last-seen'

export const DEFAULT_SETTINGS: PaperSettings = { startBalance: 10000, riskPct: 0.01, defaultLeverage: 5, maxLeverage: 20 }

export function freshState(settings: PaperSettings = DEFAULT_SETTINGS): PaperState {
  return {
    version: 1,
    balance: settings.startBalance,
    positions: [],
    journal: [],
    settings,
    takenSignals: [],
    createdAt: Date.now(),
    rev: 0,
  }
}

function load(): PaperState {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const s = JSON.parse(raw) as PaperState
      if (s.version === 1) return { ...s, settings: { ...DEFAULT_SETTINGS, ...s.settings } }
    }
  } catch {
    /* korrupt eller blokkert lagring: start på nytt */
  }
  return freshState()
}

let state = load()
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

window.addEventListener('storage', (e) => {
  if (e.key === KEY) {
    state = load()
    emit()
  }
})

export const getPaper = () => state

export function updatePaper(fn: (draft: PaperState) => void) {
  const draft = structuredClone(load()) // les siste versjon, i tilfelle en annen fane har skrevet
  fn(draft)
  draft.rev++
  state = draft
  try {
    localStorage.setItem(KEY, JSON.stringify(draft))
  } catch {
    /* full eller blokkert lagring: behold i minnet */
  }
  emit()
}

export function replacePaper(next: PaperState) {
  updatePaper((d) => Object.assign(d, next, { rev: d.rev }))
}

export function usePaper() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => state,
  )
}

export function getLastSeen() {
  const v = Number(localStorage.getItem(LAST_SEEN_KEY))
  return Number.isFinite(v) && v > 0 ? v : null
}
export function setLastSeen(t: number) {
  try {
    localStorage.setItem(LAST_SEEN_KEY, String(t))
  } catch {
    /* ignorer */
  }
}
