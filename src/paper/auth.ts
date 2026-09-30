import { useSyncExternalStore } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../supabase'

// Innlogging med lenke på e-post. Første som logger inn blir eier av kontoen (paper_claim_owner).
interface AuthState {
  user: User | null
  isOwner: boolean
  ready: boolean
}

let auth: AuthState = { user: null, isOwner: false, ready: false }
const listeners = new Set<() => void>()
const set = (next: AuthState) => {
  auth = next
  listeners.forEach((l) => l())
}

let started = false
function start() {
  if (started) return
  started = true
  supabase.auth.onAuthStateChange((_event, session) => {
    const user = session?.user ?? null
    if (!user) return set({ user: null, isOwner: false, ready: true })
    // utenfor callbacken, ellers kan supabase-js låse seg
    setTimeout(async () => {
      const { data } = await supabase.rpc('paper_claim_owner')
      set({ user, isOwner: data === true, ready: true })
    })
  })
}

export function useAuth() {
  return useSyncExternalStore(
    (cb) => {
      start()
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => auth,
  )
}

export async function sendLoginLink(email: string) {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin + window.location.pathname },
  })
  if (error) throw new Error(error.message)
}

export const signOut = () => supabase.auth.signOut()
