import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { Database } from './types'

// Environment variables
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

/**
 * Create a Supabase client for use in the browser
 */
export const createClient = () => {
  return createSupabaseClient<Database>(supabaseUrl, supabaseAnonKey)
}

/**
 * Update design code - no longer saves to database, only returns success
 */
export const updateDesignCode = async (
  supabase: any,
  designId: string,
  code: string
): Promise<{ success: boolean; error: Error | null }> => {
  // Simply log the request and return success
  console.log('Code update requested for design:', designId);
  console.log('Code length:', code?.length || 0);
  
  // Return success without actually saving to database
  return { 
    success: true, 
    error: null 
  };
}; 