import { createBrowserClient, createServerClient } from '@supabase/ssr'
import { type CookieOptions } from '@supabase/ssr'
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
export const createServerComponentClient = async () => {
  const cookieStore = await cookies()
  return createServerClient<Database>(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        get(name: string) {
          try {
            return cookieStore.get(name)?.value
          } catch (error) {
            console.error(`Error getting cookie ${name}:`, error)
            return undefined
          }
        },
        set(name: string, value: string, options: CookieOptions) {
          // In Next.js Server Components, we can't set cookies directly from Server Components
          // This is handled automatically by Supabase Auth
        },
        remove(name: string, options: CookieOptions) {
          // In Next.js Server Components, we can't remove cookies directly from Server Components
          // This is handled automatically by Supabase Auth
        },
      },
    }
  )
}

/**
 * Helper to check authentication status on the server
 */
export async function isAuthenticated() {
  const supabase = await createServerComponentClient()
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