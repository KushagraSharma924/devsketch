// app/page.tsx
'use client'

import { FaDiscord, FaLinkedin } from 'react-icons/fa';
import { IoClose } from 'react-icons/io5';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

// Create Supabase client
const supabase = createClient();

export default function Home() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

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
      }
    );

    // Clean up the subscription
    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  // Close user menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setShowUserMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleDrawDesignClick = () => {
    if (user) {
      // User is logged in, redirect to draw page
      router.push('/draw');
    } else {
      // User is not logged in, redirect to login page
      router.push('/login?next=/draw');
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

  // Get user initial for avatar
  const getUserInitial = () => {
    if (user?.user_metadata?.full_name) {
      return user.user_metadata.full_name.charAt(0).toUpperCase();
    } else if (user?.email) {
      return user.email.charAt(0).toUpperCase();
    }
    return 'J'; // Default fallback
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
            onClick={() => setShowUserMenu(!showUserMenu)}
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
                  onClick={() => router.push('/draw')}
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
    </main>
  );
}
