import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { Database } from './types';

/**
 * Create a Supabase client for use in server components and API routes
 * This version is compatible with Edge runtime
 */
export const createClient = () => {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        persistSession: false,
      },
      global: {
        fetch: customFetch
      },
      // Add reasonable timeouts to prevent hanging requests
      db: {
        schema: 'public',
      },
      realtime: {
        params: {
          eventsPerSecond: 10
        }
      }
    }
  );
};

/**
 * Custom fetch function with timeout to prevent hanging requests
 */
const customFetch = async (url: RequestInfo | URL, options?: RequestInit) => {
  const timeout = 10000; // 10 seconds timeout
  
  // Create an abort controller to timeout the request
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    console.error('Supabase fetch error:', error);
    // Re-throw the error with a more specific message
    throw new Error(`Failed to connect to Supabase: ${error instanceof Error ? error.message : 'Connection error'}`);
  }
}; 