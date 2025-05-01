import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const supabase = createClient(supabaseUrl, supabaseAnonKey)

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  
  try {
    console.log('Auth callback received at:', new Date().toISOString())
    console.log('Full callback URL:', requestUrl.toString())
    console.log('Query params:', Object.fromEntries(requestUrl.searchParams.entries()))
    console.log('Hash fragment:', requestUrl.hash)

    const next = requestUrl.searchParams.get('next') || '/draw'
    const error = requestUrl.searchParams.get('error')

    // Handle OAuth errors first
    if (error) {
      console.error('OAuth error returned:', error)
      return NextResponse.redirect(
        `${requestUrl.origin}/login?error=${encodeURIComponent(error)}`
      )
    }

    // Check for existing session first
    const { data: { session }, error: sessionError } = await supabase.auth.getSession()
    
    if (sessionError) {
      console.error('Error getting session:', sessionError)
      throw sessionError
    }
    
    if (session) {
      console.log('Existing session found for user:', session.user.id)
      console.log('Redirecting to:', `${requestUrl.origin}${next}`)
      return NextResponse.redirect(`${requestUrl.origin}${next}`)
    }

    // Standard code flow
    const code = requestUrl.searchParams.get('code')
    if (code) {
      console.log('Code flow detected, exchanging code for session')
      const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
      
      if (exchangeError) {
        console.error('Code exchange error:', exchangeError)
        throw exchangeError
      }
      
      console.log('Code exchange successful, user ID:', data.session?.user.id)
      console.log('Redirecting to:', `${requestUrl.origin}${next}`)
      return NextResponse.redirect(`${requestUrl.origin}${next}`)
    }

    // Implicit flow (hash fragment)
    if (requestUrl.hash) {
      console.log('Hash fragment detected, attempting implicit flow')
      const fragmentParams = new URLSearchParams(requestUrl.hash.substring(1))
      const accessToken = fragmentParams.get('access_token')
      if (accessToken) {
        const { error: setError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: fragmentParams.get('refresh_token') || ''
        })
        
        if (setError) {
          console.error('Error setting session from hash:', setError)
          throw setError
        }
        
        console.log('Implicit flow successful')
        console.log('Redirecting to:', `${requestUrl.origin}${next}`)
        return NextResponse.redirect(`${requestUrl.origin}${next}`)
      }
    }

    // If we get here but user is authenticated in Supabase,
    // the session cookie might be set but not detected
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    
    if (userError) {
      console.error('Error getting user:', userError)
      throw userError
    }
    
    if (user) {
      console.log('User authenticated but no session in handler:', user.id)
      console.log('Attempting to refresh session...')
      
      try {
        // Try to refresh the session
        const { error: refreshError } = await supabase.auth.refreshSession()
        if (refreshError) {
          console.warn('Session refresh failed:', refreshError)
        } else {
          console.log('Session refreshed successfully')
        }
      } catch (refreshErr) {
        console.error('Error during session refresh:', refreshErr)
      }
      
      console.log('Redirecting to:', `${requestUrl.origin}${next}`)
      return NextResponse.redirect(`${requestUrl.origin}${next}`)
    }

    // Final fallback
    console.error('Auth callback failed: No authentication method detected')
    return NextResponse.redirect(
      `${requestUrl.origin}/login?error=No+authentication+method+detected`
    )

  } catch (err) {
    console.error('Auth callback error:', err)
    return NextResponse.redirect(
      `${requestUrl.origin}/login?error=${encodeURIComponent(
        err instanceof Error ? err.message : 'Authentication failed'
      )}`
    )
  }
}