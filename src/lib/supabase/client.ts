import { createBrowserClient } from '@supabase/ssr'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { type Database } from './types'

// Environment variables
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

/**
 * Create a Supabase client for use in the browser
 */
export const createClient = () => {
  return createBrowserClient<Database>(supabaseUrl, supabaseAnonKey)
}

/**
 * Create a Supabase client for use in server components
 */
export const createServerComponentClient = () => {
  const cookieStore = cookies()
  
  return createServerClient<Database>(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        get(name) {
          return cookieStore.get(name)?.value
        },
      },
    }
  )
}

/**
 * Helper to check authentication status on the server
 */
export async function isAuthenticated() {
  const supabase = createServerComponentClient()
  try {
    const { data: { session }, error } = await supabase.auth.getSession()
    return { 
      isAuthenticated: !!session, 
      user: session?.user || null,
      error 
    }
  } catch (error) {
    console.error('Error checking authentication:', error)
    return { isAuthenticated: false, user: null, error }
  }
} 