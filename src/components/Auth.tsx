'use client';

import { useState, useEffect, FormEvent } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import Image from 'next/image';

// Create Supabase client
const supabase = createClient();

interface AuthProps {
  redirectPath?: string;
}

export default function Auth({ redirectPath = '/draw' }: AuthProps) {
  const router = useRouter();
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [user, setUser] = useState<any>(null);

  // Check if user is already logged in
  useEffect(() => {
    const checkSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const { data: { user } } = await supabase.auth.getUser();
        setUser(user);
        
        if (session) {
          console.log('Session found, redirecting to:', redirectPath);
          router.push(redirectPath);
        }
      } catch (err) {
        console.error('Error checking session:', err);
        setError(err instanceof Error ? err.message : 'Failed to check authentication status');
      }
    };

    checkSession();
  }, [router, redirectPath]);

  // Sign in with OAuth provider
  async function signInWithGoogle() {
    setLoading(true);
    setError(null);
    
    try {
      // Ensure the redirect URI is properly encoded and formatted
      const callbackUrl = new URL('/auth/callback', location.origin);
      callbackUrl.searchParams.set('next', redirectPath);
      
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: callbackUrl.toString(),
          queryParams: {
            // Always request a refresh token and explicitly set access type
            access_type: 'offline',
            prompt: 'consent',
          }
        }
      });

      if (error) throw error;
      
      // The OAuth flow will redirect the user away from the page,
      // so we don't need to handle success here.
      console.log('Redirecting to Google OAuth...', data?.url);
      
    } catch (err) {
      console.error('Google OAuth error:', err);
      setError(err instanceof Error ? err.message : 'Failed to initialize Google sign-in');
      setLoading(false);
    }
  }

  // Sign in with GitHub
  async function signInWithGitHub() {
    setLoading(true);
    setError(null);
    
    try {
      // Ensure the redirect URI is properly encoded and formatted
      const callbackUrl = new URL('/auth/callback', location.origin);
      callbackUrl.searchParams.set('next', redirectPath);
      
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'github',
        options: {
          redirectTo: callbackUrl.toString()
        }
      });

      if (error) throw error;
      
      // The OAuth flow will redirect the user away from the page,
      // so we don't need to handle success here.
      console.log('Redirecting to GitHub OAuth...', data?.url);
      
    } catch (err) {
      console.error('GitHub OAuth error:', err);
      setError(err instanceof Error ? err.message : 'Failed to initialize GitHub sign-in');
      setLoading(false);
    }
  }

  // Sign in with email and password
  async function signInWithEmail(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    
    if (authMode === 'signin') {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (error) {
        setError(error.message);
        setLoading(false);
      } else {
        // Redirect happens automatically via the session check
        router.refresh();
      }
    } else {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${location.origin}/auth/callback?next=${redirectPath}`
        }
      });

      if (error) {
        setError(error.message);
      } else {
        setMessage('Check your email for a confirmation link.');
      }
      
      setLoading(false);
    }
  }

  // Sign out the user
  async function signOut() {
    const { error } = await supabase.auth.signOut();
    
    if (error) {
      setError(error.message);
    } else {
      setUser(null);
      router.push('/');
      router.refresh();
    }
  }

  // If already logged in, show profile info
  if (user) {
    return (
      <div className="max-w-md mx-auto mt-10 p-6 bg-white rounded-xl shadow-md">
        <h2 className="text-2xl font-semibold mb-4 text-center">Profile</h2>
        <div className="flex flex-col items-center mb-6">
          {user.user_metadata?.avatar_url && (
            <Image 
              src={user.user_metadata.avatar_url}
              alt="Profile"
              width={80}
              height={80}
              className="rounded-full mb-3"
            />
          )}
          <h3 className="text-lg font-medium">{user.email}</h3>
          <p className="text-gray-500 text-sm">
            {user.user_metadata?.full_name || user.user_metadata?.name || 'User'}
          </p>
        </div>
        <div className="space-y-4">
          <button
            onClick={() => router.push('/draw')}
            className="w-full bg-blue-500 hover:bg-blue-600 text-white py-2 px-4 rounded transition-colors flex items-center justify-center"
          >
            <span>Go to Drawing Canvas</span>
          </button>
          <button
            onClick={signOut}
            className="w-full bg-gray-200 hover:bg-gray-300 text-gray-800 py-2 px-4 rounded transition-colors"
          >
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto mt-10 p-6 bg-white rounded-xl shadow-md">
      <h2 className="text-2xl font-semibold mb-6 text-center">
        {authMode === 'signin' ? 'Sign In' : 'Create Account'}
      </h2>
      
      {/* Error and message display */}
      {error && (
        <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
          {error}
        </div>
      )}
      
      {message && (
        <div className="mb-4 p-3 bg-green-100 border border-green-400 text-green-700 rounded">
          {message}
        </div>
      )}
      
      {/* OAuth providers */}
      <div className="flex flex-col gap-3 mb-6">
        <button
          onClick={signInWithGoogle}
          disabled={loading}
          className="w-full bg-white border border-gray-300 hover:bg-gray-50 text-gray-800 py-2 px-4 rounded flex items-center justify-center transition-colors"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" className="mr-2">
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            />
          </svg>
          Continue with Google
        </button>
        
        <button
          onClick={signInWithGitHub}
          disabled={loading}
          className="w-full bg-gray-900 hover:bg-black text-white py-2 px-4 rounded flex items-center justify-center transition-colors"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="white" className="mr-2">
            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
          </svg>
          Continue with GitHub
        </button>
      </div>
      
      <div className="relative mb-6">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-gray-300"></div>
        </div>
        <div className="relative flex justify-center text-sm">
          <span className="px-2 bg-white text-gray-500">Or with email</span>
        </div>
      </div>
      
      {/* Email form */}
      <form onSubmit={signInWithEmail} className="space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
            Email address
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-blue-500 hover:bg-blue-600 text-white py-2 px-4 rounded transition-colors flex items-center justify-center"
        >
          {loading ? (
            <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          ) : null}
          {authMode === 'signin' ? 'Sign In' : 'Sign Up'}
        </button>
      </form>
      
      <div className="mt-4 text-center">
        <button
          onClick={() => {
            setAuthMode(authMode === 'signin' ? 'signup' : 'signin');
            setError(null);
            setMessage(null);
          }}
          className="text-blue-500 hover:text-blue-700 text-sm"
        >
          {authMode === 'signin'
            ? "Don't have an account? Sign Up"
            : 'Already have an account? Sign In'}
        </button>
      </div>
    </div>
  );
} 