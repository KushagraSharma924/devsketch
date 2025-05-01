// app/page.tsx
'use client'

import { FaDiscord, FaLinkedin, FaPlus } from 'react-icons/fa';
import { IoClose } from 'react-icons/io5';
import { useState, useEffect, useRef, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

// Create Supabase client
const supabase = createClient();

export default function Home() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [showSidebar, setShowSidebar] = useState(false);
  const [userDesigns, setUserDesigns] = useState<any[]>([]);
  const [designsLoading, setDesignsLoading] = useState(false);
  
  const userMenuRef = useRef<HTMLDivElement>(null);
  const authModalRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);

  // Check for authentication status when component mounts
  useEffect(() => {
    const checkUser = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const { data: { user } } = await supabase.auth.getUser();
        setUser(user);
        setLoading(false);
      } catch (error) {
        console.error('Error checking auth status:', error);
        setLoading(false);
      }
    };

    checkUser();

    // Also set up auth listener for real-time updates
    const { data: authListener } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setUser(session?.user || null);
        if (session?.user) {
          setShowAuthModal(false); // Close modal when user signs in
        }
      }
    );

    // Clean up the subscription
    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  // Fetch user designs when user is authenticated
  useEffect(() => {
    const fetchUserDesigns = async () => {
      if (!user) return;
      
      try {
        setDesignsLoading(true);
        const { data, error } = await supabase
          .from('designs')
          .select('id, created_at, session_id')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(5);
        
        if (error) throw error;
        
        setUserDesigns(data || []);
      } catch (error) {
        console.error('Error fetching user designs:', error);
      } finally {
        setDesignsLoading(false);
      }
    };
    
    fetchUserDesigns();
  }, [user]);

  // Close user menu and sidebar when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setShowUserMenu(false);
      }
      
      if (sidebarRef.current && !sidebarRef.current.contains(event.target as Node)) {
        setShowSidebar(false);
      }
      
      // Don't close auth modal if click is inside the modal
      if (authModalRef.current && !authModalRef.current.contains(event.target as Node)) {
        // Only close if clicking on the backdrop (not a direct child of the modal)
        if ((event.target as Element).classList.contains('auth-modal-backdrop')) {
          setShowAuthModal(false);
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Sign in with Google
  async function signInWithGoogle() {
    setAuthLoading(true);
    setAuthError(null);
    
    try {
      const callbackUrl = new URL('/auth/callback', location.origin);
      callbackUrl.searchParams.set('next', '/draw');
      
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: callbackUrl.toString(),
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
          }
        }
      });

      if (error) throw error;
      
      // OAuth flow will handle redirect
      console.log('Redirecting to Google OAuth...', data?.url);
      
    } catch (err) {
      console.error('Google OAuth error:', err);
      setAuthError(err instanceof Error ? err.message : 'Failed to initialize Google sign-in');
      setAuthLoading(false);
    }
  }

  // Sign in with GitHub
  async function signInWithGitHub() {
    setAuthLoading(true);
    setAuthError(null);
    
    try {
      const callbackUrl = new URL('/auth/callback', location.origin);
      callbackUrl.searchParams.set('next', '/draw');
      
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'github',
        options: {
          redirectTo: callbackUrl.toString()
        }
      });

      if (error) throw error;
      
      // OAuth flow will handle redirect
      console.log('Redirecting to GitHub OAuth...', data?.url);
      
    } catch (err) {
      console.error('GitHub OAuth error:', err);
      setAuthError(err instanceof Error ? err.message : 'Failed to initialize GitHub sign-in');
      setAuthLoading(false);
    }
  }

  // Sign in with email and password
  async function signInWithEmail(e: FormEvent) {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError(null);
    
    if (authMode === 'signin') {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (error) {
        setAuthError(error.message);
        setAuthLoading(false);
      } else {
        // Auth state listener will handle closing the modal
        router.refresh();
      }
    } else {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${location.origin}/auth/callback?next=/draw`
        }
      });

      if (error) {
        setAuthError(error.message);
      } else {
        setAuthMessage('Check your email for a confirmation link.');
      }
      
      setAuthLoading(false);
    }
  }

  const handleDrawDesignClick = () => {
    if (user) {
      // User is logged in, redirect to draw page
      router.push('/draw');
    } else {
      // User is not logged in, show auth modal
      setShowAuthModal(true);
    }
  };

  const handleSignOut = async () => {
    try {
      await supabase.auth.signOut();
      setShowUserMenu(false);
      // Router will automatically update due to auth state change
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  // Create a new design and navigate to draw page
  const handleNewDesign = async () => {
    if (!user) {
      setShowAuthModal(true);
      return;
    }
    
    try {
      const newSessionId = crypto.randomUUID();
      
      const { data: newDesign, error } = await supabase
        .from('designs')
        .insert({
          user_id: user.id,
          excalidraw_data: [],
          session_id: newSessionId,
          created_by_id: user.id
        })
        .select('id')
        .single();
      
      if (error) throw error;
      
      if (newDesign) {
        router.push('/draw?id=' + newDesign.id);
      }
    } catch (error) {
      console.error('Failed to create new design:', error);
    }
  };

  // Get user initial for avatar
  const getUserInitial = () => {
    if (user?.user_metadata?.full_name) {
      return user.user_metadata.full_name.charAt(0).toUpperCase();
    } else if (user?.email) {
      return user.email.charAt(0).toUpperCase();
    }
    return 'J'; // Default fallback
  };

  // Format date to human readable format
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      hour: 'numeric', 
      minute: 'numeric'
    });
  };

  return (
    <main className="relative flex flex-col items-center justify-center min-h-screen bg-black text-white font-sans px-4 overflow-hidden">
      
      {/* Glow gradient background */}
      <div className="absolute top-0 w-full h-[150px] bg-blue-950 blur-2xl pointer-events-none" />

      {/* Top right icons */}
      <div className="absolute top-4 right-4 flex items-center gap-4 text-white text-xl">
        <FaLinkedin className="hover:text-cyan-400 cursor-pointer" />
        <FaDiscord className="hover:text-cyan-400 cursor-pointer" />
        <IoClose className="hover:text-red-500 cursor-pointer" />
      </div>

      {/* User avatar and menu - only show when logged in */}
      {user && (
        <div className="absolute bottom-4 left-4" ref={userMenuRef}>
          <div 
            className="w-8 h-8 rounded-full bg-green-400 text-black flex items-center justify-center font-bold text-sm cursor-pointer"
            onClick={() => {
              setShowUserMenu(!showUserMenu);
              setShowSidebar(false);
            }}
          >
            {getUserInitial()}
          </div>
          
          {/* User dropdown menu */}
          {showUserMenu && (
            <div className="absolute bottom-full mb-2 left-0 w-48 bg-[#111] border border-neutral-700 rounded-lg shadow-lg z-10 overflow-hidden">
              <div className="px-4 py-3 border-b border-neutral-700">
                <p className="text-sm font-medium truncate">{user.email}</p>
              </div>
              <div className="py-1">
                <button 
                  onClick={() => {
                    setShowUserMenu(false);
                    setShowSidebar(!showSidebar);
                  }}
                  className="w-full text-left px-4 py-2 text-sm hover:bg-neutral-800 transition-colors"
                >
                  My Designs
                </button>
                <button 
                  onClick={handleSignOut}
                  className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-neutral-800 transition-colors"
                >
                  Sign Out
                </button>
              </div>
            </div>
          )}
          
          {/* Sidebar drawer */}
          {showSidebar && (
            <div className="absolute bottom-0 left-full ml-2 w-64 bg-[#111] border border-neutral-700 rounded-lg shadow-lg z-10 overflow-hidden"
                 ref={sidebarRef}>
              <div className="px-4 py-3 border-b border-neutral-700 flex items-center justify-between">
                <h3 className="text-sm font-medium">Recent Designs</h3>
                <button 
                  onClick={handleNewDesign}
                  className="text-blue-400 hover:text-blue-300 text-sm flex items-center"
                >
                  <FaPlus className="mr-1" size={12} />
                  New
                </button>
              </div>
              <div className="py-1 max-h-[calc(70vh-40px)] overflow-auto">
                {designsLoading ? (
                  <div className="flex justify-center py-4">
                    <div className="w-5 h-5 border-2 border-t-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                  </div>
                ) : userDesigns.length === 0 ? (
                  <div className="px-4 py-3 text-sm text-gray-400">
                    No designs yet. Create your first design!
                  </div>
                ) : (
                  userDesigns.map((design) => (
                    <button
                      key={design.id}
                      onClick={() => router.push(`/draw?id=${design.id}`)}
                      className="w-full text-left px-4 py-2 text-sm hover:bg-neutral-800 transition-colors border-b border-neutral-700 last:border-b-0"
                    >
                      <div className="font-medium truncate">Design {design.id.slice(0, 8)}...</div>
                      <div className="text-xs text-gray-400">{formatDate(design.created_at)}</div>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Notification banner */}
      <div className="mb-6 text-sm text-yellow-400 font-medium">
        ⚡ $1M+ Hackathon registration is live!
      </div>

      {/* Main content */}
      <div className="text-center max-w-2xl">
        <h1 className="text-4xl md:text-5xl font-bold mb-4">What do you want to build?</h1>
        <p className="text-lg text-gray-400 mb-8">
          Draw, run, edit, and deploy full-stack <span className="text-white font-semibold">web</span> and <span className="text-white font-semibold">mobile</span> apps.
        </p>

        {/* Draw Design to Code Button */}
        <div className="flex justify-center mb-8">
          <button 
            onClick={handleDrawDesignClick}
            className="bg-gradient-to-r from-cyan-700 to-blue-900 px-6 py-3 rounded-lg font-medium text-lg shadow-lg hover:shadow-cyan-500/20 transition-all duration-300 hover:-translate-y-1 relative"
            disabled={loading}
          >
            {loading ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-5 h-5 border-2 border-t-2 border-white border-t-transparent rounded-full animate-spin"></div>
              </div>
            ) : null}
            <span className={loading ? 'opacity-0' : ''}>✏️ Draw Design to Code</span>
          </button>
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap justify-center gap-3 text-sm mb-6">
          <button className="bg-gradient-to-r from-purple-600 to-pink-500 px-4 py-2 rounded-full font-medium">
            Import from Figma
          </button>
        </div>

        {/* Stack icons */}
        <div className="text-sm text-gray-500 mb-2">or start a blank app with your favorite stack</div>
        <div className="flex justify-center gap-4 opacity-50 grayscale">
          <img src="/stack-icons/nextjs.svg" alt="Next.js" className="h-6" />
          <img src="/stack-icons/vercel.svg" alt="Vercel" className="h-6" />
          <img src="/stack-icons/react.svg" alt="React" className="h-6" />
          <img src="/stack-icons/vue.svg" alt="Vue" className="h-6" />
        </div>
      </div>

      {/* Auth Modal */}
      {showAuthModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 auth-modal-backdrop">
          <div 
            className="bg-[#111] border border-neutral-700 rounded-xl p-6 max-w-md w-full animate-fade-in"
            ref={authModalRef}
          >
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold">
                {authMode === 'signin' ? 'Sign In' : 'Create Account'}
              </h3>
              <button 
                onClick={() => setShowAuthModal(false)} 
                className="text-gray-400 hover:text-white"
              >
                <IoClose size={24} />
              </button>
            </div>
            
            {/* Error and message display */}
            {authError && (
              <div className="mb-4 p-3 bg-red-900/50 border border-red-700 text-red-200 rounded">
                {authError}
              </div>
            )}
            
            {authMessage && (
              <div className="mb-4 p-3 bg-green-900/50 border border-green-700 text-green-200 rounded">
                {authMessage}
              </div>
            )}
            
            {/* OAuth providers */}
            <div className="flex flex-col gap-3 mb-6">
              <button
                onClick={signInWithGoogle}
                disabled={authLoading}
                className="w-full bg-[#222] hover:bg-[#333] text-white py-2 rounded-lg flex items-center justify-center transition-colors"
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
                disabled={authLoading}
                className="w-full bg-[#222] hover:bg-[#333] text-white py-2 rounded-lg flex items-center justify-center transition-colors"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="white" className="mr-2">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                </svg>
                Continue with GitHub
              </button>
            </div>
            
            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-700"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-[#111] text-gray-400">Or with email</span>
              </div>
            </div>
            
            {/* Email form */}
            <form onSubmit={signInWithEmail} className="space-y-4">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-300 mb-1">
                  Email address
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full px-3 py-2 bg-[#222] border border-neutral-700 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-white"
                />
              </div>
              
              <div>
                <label htmlFor="password" className="block text-sm font-medium text-gray-300 mb-1">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full px-3 py-2 bg-[#222] border border-neutral-700 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-white"
                />
              </div>
              
              <button
                type="submit"
                disabled={authLoading}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded-lg transition-colors flex items-center justify-center"
              >
                {authLoading ? (
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
                  setAuthError(null);
                  setAuthMessage(null);
                }}
                className="text-blue-400 hover:text-blue-300 text-sm"
              >
                {authMode === 'signin'
                  ? "Don't have an account? Sign Up"
                  : 'Already have an account? Sign In'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
