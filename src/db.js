import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)

export async function loadData(userId) {
  const { data, error } = await supabase
    .from('finance_data')
    .select('data')
    .eq('user_id', userId)
    .single()
  if (error) return null
  return data?.data || null
}

export async function saveData(userId, payload) {
  const { error } = await supabase
    .from('finance_data')
    .upsert({ user_id: userId, data: payload, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' })
  if (error) console.error('Save error:', error)
}
