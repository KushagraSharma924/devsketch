'use client';

import { useCallback, useEffect, useState, useRef } from 'react';
import React from 'react';
import dynamic from 'next/dynamic';
import { createClient } from '@/lib/supabase/client';
import { PostgrestError } from '@supabase/supabase-js';

// Proper UUID generator that matches PostgreSQL's UUID format
function generateUUID(): string {
  // Format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
  // Where x is any hexadecimal digit and y is one of 8, 9, A, or B
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

// Import Excalidraw dynamically with no SSR
const Excalidraw = dynamic(
  () => import('@excalidraw/excalidraw').then((mod) => mod.Excalidraw),
  { ssr: false }
);

const supabase = createClient();

export default function Canvas() {
  const [elements, setElements] = useState<readonly any[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [designId, setDesignId] = useState<string | null>(null);
  const excalidrawRef = useRef<any | null>(null);
  const isSaving = useRef(false); // Track ongoing saves to avoid race conditions
  const [isLoading, setIsLoading] = useState(true);
  
  // Error handling states
  const [supabaseError, setSupabaseError] = useState<PostgrestError | Error | null>(null);
  const [excalidrawError, setExcalidrawError] = useState<Error | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Save to local storage as fallback
  const saveToLocalStorage = useCallback((els: readonly any[]) => {
    try {
      localStorage.setItem('excalidraw-backup', JSON.stringify(els));
      localStorage.setItem('excalidraw-session-id', sessionId || '');
      setToast('Saved to local storage');
      setTimeout(() => setToast(null), 3000);
    } catch (err) {
      console.error('Failed to save to localStorage:', err);
    }
  }, [sessionId]);

  // Load from local storage fallback
  const loadFromLocalStorage = useCallback(() => {
    try {
      const saved = localStorage.getItem('excalidraw-backup');
      const savedSessionId = localStorage.getItem('excalidraw-session-id') || generateUUID();
      
      if (saved) {
        const parsedData = JSON.parse(saved);
        setElements(parsedData);
        setSessionId(savedSessionId);
        setToast('Loaded from local storage');
        setTimeout(() => setToast(null), 3000);
        return true;
      } else if (!sessionId) {
        // If nothing in localStorage but we need a session ID
        setSessionId(generateUUID());
      }
    } catch (err) {
      console.error('Failed to load from localStorage:', err);
      // Create new session ID if we couldn't load one
      if (!sessionId) setSessionId(generateUUID());
    }
    return false;
  }, [sessionId]);

  // Initialize session when component mounts
  useEffect(() => {
    // Create a new session ID if one doesn't exist
    if (!sessionId) {
      const newSessionId = generateUUID();
      setSessionId(newSessionId);
      localStorage.setItem('excalidraw-session-id', newSessionId);
    }
  }, [sessionId]);

  // Create a fallback design with local data only
  const createLocalDesign = useCallback(() => {
    const newSessionId = generateUUID();
    setSessionId(newSessionId);
    setDesignId(`local-${newSessionId}`);
    setElements([]);
    loadFromLocalStorage();
    setToast('Created local design - changes will save to local storage');
    setTimeout(() => setToast(null), 3000);
  }, [loadFromLocalStorage]);

  // Fetch user ID and initial data on mount
  useEffect(() => {
    let mounted = true;
    setIsLoading(true);
    
    const fetchData = async () => {
      try {
        // Reset error state on new attempt
        if (mounted) setSupabaseError(null);
        
        // Check if we have an active session
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        
        if (sessionError) {
          console.error('Session error in Canvas component:', sessionError);
          throw sessionError;
        }
        
        if (!session) {
          console.warn('No active session found in Canvas component');
          // Use the fallback to create local design
          createLocalDesign();
          setIsLoading(false);
          return;
        }
        
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        
        if (authError) {
          console.error('Auth error in Canvas component:', authError);
          throw authError;
        }
        
        if (!user) {
          console.warn('No user found in Canvas component');
          // Use the fallback to create local design
          createLocalDesign();
          setIsLoading(false);
          return;
        }
        
        if (user && mounted) {
          console.log('User authenticated in Canvas component:', user.id);
          setUserId(user.id);

          // Create a new session ID for this drawing session
          const newSessionId = sessionId || generateUUID();
          if (!sessionId) setSessionId(newSessionId);

          try {
            // Load most recent design if it exists
            console.log('Loading designs for user:', user.id);
            const { data: designData, error } = await supabase
              .from('designs')
              .select('id, excalidraw_data, session_id')
              .eq('user_id', user.id)
              .order('created_at', { ascending: false })
              .limit(1)
              .single();

            if (error && error.code !== 'PGRST116') {
              // Log the specific database error
              console.error('Database query error in Canvas component:', error);
              throw error;
            }
            
            if (designData?.excalidraw_data && mounted) {
              console.log('Loaded existing design:', designData.id);
              setElements(designData.excalidraw_data);
              setDesignId(designData.id);
              // If we have a session_id from the design, use it
              if (designData.session_id) {
                setSessionId(designData.session_id);
              }
            } else {
              // If no existing design, create a new one
              console.log('No existing design found, creating new one');
              
              const { data: newDesign, error: insertError } = await supabase
                .from('designs')
                .insert({
                  user_id: user.id,
                  excalidraw_data: [],
                  session_id: newSessionId
                })
                .select('id')
                .single();
              
              if (insertError) {
                console.error('Error creating new design in Canvas component:', insertError);
                throw insertError;
              }
              
              if (newDesign && mounted) {
                console.log('New design created with ID:', newDesign.id);
                setDesignId(newDesign.id);
              }
            }
          } catch (dbError) {
            console.error('Database operation error in Canvas component:', dbError);
            // Fall back to local storage if database operations fail
            createLocalDesign();
          }
        }
      } catch (error) {
        console.error('Authentication or data loading error in Canvas component:', error instanceof Error ? error.message : JSON.stringify(error));
        if (mounted) {
          setSupabaseError(error instanceof Error ? error : new Error('Authentication failed'));
          // Try to load from local storage as fallback
          loadFromLocalStorage();
        }
      } finally {
        if (mounted) setIsLoading(false);
      }
    };

    fetchData();
    return () => { mounted = false; };
  }, [loadFromLocalStorage, sessionId, createLocalDesign]);

  // Realtime updates (remote changes)
  useEffect(() => {
    if (!userId || !designId) return;

    let channel: any;
    
    try {
      channel = supabase
        .channel('design-updates')
        .on('postgres_changes', {
          event: 'UPDATE',
          schema: 'public',
          table: 'designs',
          filter: `id=eq.${designId}`,
        }, (payload) => {
          if (!isSaving.current) { // Only update if not from local save
            setElements(payload.new.excalidraw_data);
          }
        })
        .subscribe((status) => {
          if (status === 'CHANNEL_ERROR') {
            setSupabaseError(new Error('Realtime connection failed'));
            setToast('Realtime updates unavailable - using local mode');
            setTimeout(() => setToast(null), 3000);
          }
        });
    } catch (err) {
      setSupabaseError(err as Error);
    }

    return () => {
      if (channel) channel.unsubscribe();
    };
  }, [userId, designId]);

  // Save function (debounced)
  const saveToSupabase = useCallback(async (els: readonly any[]) => {
    if (!userId || !designId || isSaving.current) return;
    
    // If using a local design ID, only save to localStorage
    if (designId.startsWith('local-')) {
      saveToLocalStorage(els);
      return;
    }

    isSaving.current = true;
    try {
      const { error } = await supabase
        .from('designs')
        .update({
          excalidraw_data: els,
          created_at: new Date().toISOString()
        })
        .eq('id', designId);
      
      if (error) throw error;
      
      // Clear supabase error on successful save
      if (supabaseError) setSupabaseError(null);
      
      setToast('Drawing saved');
      setTimeout(() => setToast(null), 3000);
      
    } catch (error) {
      console.error('Save error:', error);
      setSupabaseError(error as Error);
      
      // Fallback to local storage
      setToast('Connection lost - saving locally');
      saveToLocalStorage(els);
    } finally {
      isSaving.current = false;
    }
  }, [userId, designId, supabaseError, saveToLocalStorage]);

  // Auto-save on changes (debounced)
  useEffect(() => {
    if (elements.length === 0) return;

    const timer = setTimeout(() => {
      // Try Supabase first
      if (!supabaseError && userId && designId) {
        saveToSupabase(elements);
      } else {
        // Fallback to localStorage if Supabase is unavailable
        saveToLocalStorage(elements);
      }
    }, 1000);

    return () => clearTimeout(timer);
  }, [elements, saveToSupabase, supabaseError, userId, designId, saveToLocalStorage]);

  // Create a new drawing session
  const createNewSession = async () => {
    if (!userId) {
      // Create a local session if not authenticated
      const newSessionId = generateUUID();
      setSessionId(newSessionId);
      setDesignId(`local-${newSessionId}`);
      setElements([]);
      setToast('New local drawing session created');
      setTimeout(() => setToast(null), 3000);
      return;
    }
    
    try {
      const newSessionId = generateUUID();
      setSessionId(newSessionId);
      
      const { data: newDesign, error } = await supabase
        .from('designs')
        .insert({
          user_id: userId,
          excalidraw_data: [],
          session_id: newSessionId
        })
        .select('id')
        .single();
      
      if (error) throw error;
      
      if (newDesign) {
        setDesignId(newDesign.id);
        setElements([]);
        setToast('New drawing session created');
        setTimeout(() => setToast(null), 3000);
      }
    } catch (error) {
      console.error('Failed to create new session:', error);
      setSupabaseError(error as Error);
      
      // Fall back to local session
      const newSessionId = generateUUID();
      setSessionId(newSessionId);
      setDesignId(`local-${newSessionId}`);
      setElements([]);
      setToast('Created local drawing session (offline mode)');
      setTimeout(() => setToast(null), 3000);
    }
  };

  const onChangeHandler = useCallback((els: readonly any[]) => {
    setElements(els);
    
    // If this is the first change and not just loading initial data
    if (els.length > 0 && elements.length === 0) {
      // Check if we need to create a new session
      if (!designId || (designId.startsWith('local-') && userId)) {
        createNewSession();
      }
    }
  }, [elements, designId, userId, createNewSession]);

  // Handle Excalidraw error
  const handleExcalidrawError = (error: Error) => {
    console.error('Excalidraw rendering error:', error);
    setExcalidrawError(error);
    // Save current work to local storage
    saveToLocalStorage(elements);
  };

  const retrySupabaseConnection = async () => {
    try {
      await supabase.auth.getSession();
      setSupabaseError(null);
      setToast('Reconnected to database');
      setTimeout(() => setToast(null), 3000);
    } catch (error) {
      console.error('Failed to reconnect:', error);
      setToast('Reconnection failed, try again later');
      setTimeout(() => setToast(null), 3000);
    }
  };

  const retryExcalidrawRender = () => {
    setExcalidrawError(null);
  };

  // Error display component
  if (excalidrawError) {
    return (
      <div className="h-screen w-screen">
        {/* Toast notifications */}
        {toast && (
          <div className="fixed top-4 right-4 bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded z-50 animate-fade-out">
            {toast}
          </div>
        )}
        
        {/* Supabase connection error toast */}
        {supabaseError && supabaseError instanceof Error && (
          <div className="fixed top-4 left-4 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded z-50 flex items-center gap-2">
            <div>
              <p className="font-bold">Connection issue</p>
              <p>Changes saving to local storage only</p>
            </div>
            <button 
              onClick={retrySupabaseConnection}
              className="bg-red-500 hover:bg-red-700 text-white py-1 px-2 rounded text-sm"
            >
              Reconnect
            </button>
          </div>
        )}

        {/* Excalidraw error with retry option */}
        <div className="h-full w-full flex flex-col items-center justify-center">
          <div className="max-w-md p-6 bg-white rounded-lg shadow-lg">
            <h2 className="text-xl font-bold mb-2 text-red-600">Drawing Canvas Error</h2>
            <p className="mb-4">There was a problem loading the drawing canvas. Your work has been saved locally.</p>
            <p className="text-gray-700 text-sm mb-4 font-mono">{excalidrawError && (excalidrawError as Error).message}</p>
            <button 
              onClick={retryExcalidrawRender}
              className="bg-blue-500 hover:bg-blue-700 text-white py-2 px-4 rounded"
            >
              Try Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen">
      {/* Toast notifications */}
      {toast && (
        <div className="fixed top-4 right-4 bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded z-50 animate-fade-out">
          {toast}
        </div>
      )}
      
      {/* Supabase connection error toast */}
      {supabaseError && supabaseError instanceof Error && (
        <div className="fixed top-4 left-4 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded z-50 flex items-center gap-2">
          <div>
            <p className="font-bold">Connection issue</p>
            <p>Changes saving to local storage only</p>
          </div>
          <button 
            onClick={retrySupabaseConnection}
            className="bg-red-500 hover:bg-red-700 text-white py-1 px-2 rounded text-sm"
          >
            Reconnect
          </button>
        </div>
      )}

      {/* Excalidraw error with retry option */}
      {excalidrawError ? (
        <div className="h-full w-full flex flex-col items-center justify-center">
          <div className="max-w-md p-6 bg-white rounded-lg shadow-lg">
            <h2 className="text-xl font-bold mb-2 text-red-600">Drawing Canvas Error</h2>
            <p className="mb-4">There was a problem loading the drawing canvas. Your work has been saved locally.</p>
            <p className="text-gray-700 text-sm mb-4 font-mono">{excalidrawError && (excalidrawError as Error).message}</p>
            <button 
              onClick={retryExcalidrawRender}
              className="bg-blue-500 hover:bg-blue-700 text-white py-2 px-4 rounded"
            >
              Try Again
            </button>
          </div>
        </div>
      ) : isLoading ? (
        <div className="h-full w-full flex flex-col items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500 mb-4"></div>
          <p className="text-gray-600">Loading your drawing canvas...</p>
        </div>
      ) : (
        <div className="h-full w-full relative">
          <ErrorBoundary onError={handleExcalidrawError}>
            <Excalidraw
              excalidrawAPI={(api) => (excalidrawRef.current = api)}
              onChange={onChangeHandler}
              initialData={{ elements }}
            />
          </ErrorBoundary>
        </div>
      )}
    </div>
  );
}

// Simple error boundary component
class ErrorBoundary extends React.Component<{
  children: React.ReactNode;
  onError: (error: Error) => void;
}> {
  state = { hasError: false };
  
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  
  componentDidCatch(error: Error) {
    this.props.onError(error);
  }
  
  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}