import { createClient } from '@supabase/supabase-js'

// Prosjekt-URL og publishable key er offentlige (de ligger i nettsiden uansett).
// Tilgangen styres av Row Level Security i databasen: alle kan lese, bare eieren kan handle.
const url = import.meta.env.VITE_SUPABASE_URL ?? 'https://swyvktiretbmztgualnw.supabase.co'
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_w1fUqpltPLJwvWKciDxDLA_ZNdjAvXC'

export const supabase = createClient(url, key)
