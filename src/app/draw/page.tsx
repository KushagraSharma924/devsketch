'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import Canvas from '@/components/Canvas';
import CodeEditor from '@/components/CodeEditor';
import { useEditorStore } from '@/lib/store/editor-store';
import { Framework } from '@/components/CodeEditor';
import '@excalidraw/excalidraw/index.css'; // 👈 Required for Excalidraw styling
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

// Function to generate a UUID (already exists in Canvas.tsx)
function generateUUID(): string {
  const hexDigits = '0123456789abcdef';
  let uuid = '';
  
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) {
      uuid += '-';
    } else if (i === 14) {
      uuid += '4'; // Version 4 UUID always has a 4 in this position
    } else if (i === 19) {
      // The clock_seq_hi_and_reserved field is set to one of 8, 9, A, or B
      uuid += hexDigits.charAt(Math.floor(Math.random() * 4) + 8);
    } else {
      uuid += hexDigits.charAt(Math.floor(Math.random() * 16));
    }
  }
  
  return uuid;
}

const supabase = createClient();

// Wrap the part that uses useSearchParams in a separate component
function DrawPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlDesignId = searchParams.get('id');
  const createdNewDesign = useRef(false);
  
  const { 
    code, 
    updateSupabaseCode, 
    currentFramework, 
    setCurrentFramework
  } = useEditorStore();

  // Framework selection options
  const frameworks: Framework[] = ['react', 'vue', 'svelte'];

  // Resizable split view state
  const [leftPanelWidth, setLeftPanelWidth] = useState(50); // Initial width in percent
  const [isResizing, setIsResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Handle mouse events for resizing
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing || !containerRef.current) return;
      
      const containerRect = containerRef.current.getBoundingClientRect();
      const containerWidth = containerRect.width;
      const mouseX = e.clientX - containerRect.left;
      
      // Calculate percentage (with bounds to prevent panels from becoming too small)
      let newLeftWidth = (mouseX / containerWidth) * 100;
      newLeftWidth = Math.max(20, Math.min(80, newLeftWidth)); // Limit between 20% and 80%
      
      setLeftPanelWidth(newLeftWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

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

  // Handle auto-creation of a new design when no ID is in URL
  useEffect(() => {
    const createNewDesign = async () => {
      // Only proceed if:
      // 1. We have user data (authenticated)
      // 2. There's no design ID in the URL
      // 3. We haven't already created a design in this session
      if (userData && !urlDesignId && !createdNewDesign.current) {
        createdNewDesign.current = true; // Prevent multiple creation attempts
        
        try {
          console.log('No design ID in URL, creating a new design');
          const newSessionId = generateUUID();
          
          // Insert a new design
          const { data: newDesign, error } = await supabase
            .from('designs')
            .insert({
              user_id: userData.id,
              excalidraw_data: [],
              session_id: newSessionId,
              created_by_id: userData.id
            })
            .select('id')
            .single();
          
          if (error) {
            console.error('Error creating new design:', error);
            return;
          }
          
          if (newDesign) {
            console.log('Created new design with ID:', newDesign.id);
            // Update URL with the new design ID
            router.replace(`/draw?id=${newDesign.id}`);
            
            // Store session ID in localStorage for Excalidraw
            localStorage.setItem('excalidraw-session-id', newSessionId);
          }
        } catch (err) {
          console.error('Failed to create new design:', err);
        }
      }
    };

    createNewDesign();
  }, [userData, urlDesignId, router]);

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
    <div className="fixed inset-0 overflow-hidden">
      {/* Framework selector */}
      <div className="absolute top-4 right-4 z-10 bg-gradient-to-r from-blue-600 to-indigo-700 shadow-lg rounded-md px-3 py-2 flex items-center space-x-2 text-white border border-blue-400">
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-blue-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
        <span className="text-sm font-medium text-blue-100">Framework:</span>
        <select 
          value={currentFramework}
          onChange={(e) => setCurrentFramework(e.target.value as Framework)}
          className="bg-white text-indigo-900 border-0 rounded-md px-2 py-1 text-sm font-semibold cursor-pointer focus:ring-2 focus:ring-blue-300 focus:outline-none"
        >
          {frameworks.map(framework => (
            <option key={framework} value={framework}>
              {framework.charAt(0).toUpperCase() + framework.slice(1)}
            </option>
          ))}
        </select>
      </div>
      
      {/* Resizable split layout */}
      <div ref={containerRef} className="w-full h-full flex relative">
        {/* Left panel - Canvas */}
        <div 
          className="h-full overflow-hidden" 
          style={{ width: `${leftPanelWidth}%` }}
        >
          <div className="w-full h-full">
            <Canvas />
          </div>
        </div>
        
        {/* Resizable divider */}
        <div 
          className="w-1 bg-gray-300 hover:bg-blue-500 cursor-col-resize relative z-10 flex items-center justify-center"
          onMouseDown={handleMouseDown}
          style={{ 
            cursor: isResizing ? 'col-resize' : 'default',
          }}
        >
          <div className="h-16 w-4 bg-gray-300 hover:bg-blue-500 absolute rounded-full flex items-center justify-center">
            <div className="w-0.5 h-6 bg-gray-500 mx-0.5"></div>
            <div className="w-0.5 h-6 bg-gray-500 mx-0.5"></div>
          </div>
        </div>
        
        {/* Right panel - Code Editor */}
        <div 
          className="h-full overflow-hidden bg-white" 
          style={{ width: `${100 - leftPanelWidth}%` }}
        >
          <div className="w-full h-full">
            <CodeEditor 
              value={code} 
              onChange={(newValue) => updateSupabaseCode(newValue)}
              language={currentFramework}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DrawPage() {
  return (
    <Suspense fallback={
      <div className="flex flex-col items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500 mb-4"></div>
        <p className="text-gray-600">Loading drawing canvas...</p>
      </div>
    }>
      <DrawPageContent />
    </Suspense>
  );
}