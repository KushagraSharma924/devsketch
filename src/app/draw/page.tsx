'use client';

import Canvas from '@/components/Canvas';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import '@excalidraw/excalidraw/index.css'; // 👈 Required for Excalidraw styling
import { useRouter } from 'next/navigation';

const supabase = createClient();

export default function DrawPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [userData, setUserData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchUserData = async () => {
      try {
        setLoading(true);
        console.log('Checking authentication state in draw page...');
        
        // Try to get the current session
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        
        if (sessionError) {
          console.error('Session error in draw page:', sessionError);
          throw sessionError;
        }
        
        if (!session) {
          console.warn('No session found in draw page, redirecting to login');
          router.push('/login?next=/draw');
          return;
        }
        
        // Get user data
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        
        if (userError) {
          console.error('User fetch error in draw page:', userError);
          throw userError;
        }
        
        if (!user) {
          console.warn('No user data found, redirecting to login');
          router.push('/login?next=/draw');
          return;
        }
        
        console.log('User authenticated in draw page:', user.id);
        setUserData(user);
      } catch (error) {
        console.error('Error in draw page authentication:', error);
        setError(error instanceof Error ? error.message : 'Authentication failed');
        router.push('/login?next=/draw');
      } finally {
        setLoading(false);
      }
    };

    fetchUserData();
    
    // Set up auth state change listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log('Auth state changed in draw page:', event);
        
        if (event === 'SIGNED_OUT') {
          console.log('User signed out, redirecting to login');
          router.push('/login');
        } else if (event === 'SIGNED_IN' && session) {
          console.log('User signed in:', session.user.id);
          setUserData(session.user);
        }
      }
    );
    
    // Clean up subscription
    return () => {
      subscription.unsubscribe();
    };
  }, [router]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500 mb-4"></div>
        <p className="text-gray-600">Loading your drawing canvas...</p>
      </div>
    );
  }
  
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen">
        <div className="max-w-md p-6 bg-white rounded-lg shadow-lg">
          <h2 className="text-xl font-bold mb-2 text-red-600">Authentication Error</h2>
          <p className="mb-4">There was a problem accessing the drawing canvas:</p>
          <p className="text-gray-700 text-sm mb-4 font-mono">{error}</p>
          <button 
            onClick={() => router.push('/login?next=/draw')}
            className="bg-blue-500 hover:bg-blue-700 text-white py-2 px-4 rounded"
          >
            Return to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0"> {/* Ensures full viewport coverage */}
      <Canvas />
    </div>
  );
}