'use client';

import { useCallback, useEffect, useState, useRef } from 'react';
import React from 'react';
import dynamic from 'next/dynamic';
import { createClient } from '@/lib/supabase/client';
import { PostgrestError } from '@supabase/supabase-js';
import { useSearchParams, useRouter } from 'next/navigation';
import { useEditorStore } from '@/lib/store/editor-store';
import { updateDesignCode } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { exportToSvg } from '@excalidraw/excalidraw';

// Constants for localStorage keys
const DESIGN_TOKEN_KEY = 'devsketch-design-token';
const LAST_CODE_KEY = 'devsketch-last-code';
const EXCALIDRAW_SESSION_KEY = 'excalidraw-session-id';

// Proper UUID generator that matches PostgreSQL's UUID format
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

// Import Excalidraw dynamically with no SSR
const Excalidraw = dynamic(
  () => import('@excalidraw/excalidraw').then((mod) => mod.Excalidraw),
  { ssr: false }
);

const supabase = createClient();

// Helper function to get current user ID from Supabase
const getCurrentUserId = async (): Promise<string | null> => {
  try {
    // Check if there's an active session
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;
    
    // Get the user from the session
    const { data: { user } } = await supabase.auth.getUser();
    return user?.id || null;
  } catch (error) {
    console.error('Error getting current user ID:', error);
    return null;
  }
};

export default function Canvas() {
  const searchParams = useSearchParams();
  const urlDesignId = searchParams.get('id');
  const router = useRouter();
  
  const [elements, setElements] = useState<readonly any[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [designId, setDesignId] = useState<string | null>(urlDesignId);
  const excalidrawRef = useRef<any | null>(null);
  const isSaving = useRef(false); // Track ongoing saves to avoid race conditions
  const [isLoading, setIsLoading] = useState(true);
  
  // Generate Code state
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  
  // Access Zustand store
  const setStoreElements = useEditorStore(state => state.setElements);
  const setStoreCode = useEditorStore(state => state.setCode);
  const storeDesignId = useEditorStore(state => state.designId);
  const setStoreDesignId = useEditorStore(state => state.setDesignId);
  const storeUserId = useEditorStore(state => state.userId);
  const setStoreUserId = useEditorStore(state => state.setUserId);
  
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
          setStoreUserId(user.id);

          // Create a new session ID for this drawing session
          const newSessionId = sessionId || generateUUID();
          if (!sessionId) setSessionId(newSessionId);

          try {
            // If we have a design ID from URL, try to load that specific design
            if (urlDesignId) {
              console.log('Loading specific design from URL:', urlDesignId);
              const { data: specificDesign, error: specificError } = await supabase
                .from('designs')
                .select('id, excalidraw_data, session_id')
                .eq('id', urlDesignId)
                .single();
                
              if (specificError) {
                console.error('Error loading specific design:', specificError);
                throw specificError;
              }
              
              if (specificDesign?.excalidraw_data && mounted) {
                console.log('Loaded specific design:', specificDesign.id);
                setElements(specificDesign.excalidraw_data);
                setStoreElements(specificDesign.excalidraw_data);
                setDesignId(specificDesign.id);
                setStoreDesignId(specificDesign.id);
                // If we have a session_id from the design, use it
                if (specificDesign.session_id) {
                  setSessionId(specificDesign.session_id);
                }
                setIsLoading(false);
                return;
              }
            }
            
            // If we get here and there's no design ID, the DrawPage component should be handling
            // the creation of a new design, so we should wait for the URL to be updated
            if (!urlDesignId) {
              console.log('No design ID in URL, waiting for DrawPage to create one...');
              setIsLoading(true);
              return;
            }
            
            // If no URL design ID or it wasn't found, load most recent design as fallback
            console.log('Loading most recent design for user:', user.id);
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
              setStoreElements(designData.excalidraw_data);
              setDesignId(designData.id);
              setStoreDesignId(designData.id);
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
                  session_id: newSessionId,
                  created_by_id: user.id
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
                setStoreDesignId(newDesign.id);
                
                // Update URL with the new design ID 
                if (!urlDesignId) {
                  router.replace(`/draw?id=${newDesign.id}`);
                }
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
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    fetchData();
    return () => { mounted = false; };
  }, [urlDesignId, createLocalDesign, sessionId, setStoreElements, setStoreDesignId, setStoreUserId]);

  // Update Zustand store whenever elements change
  useEffect(() => {
    if (elements.length > 0) {
      setStoreElements(elements as any[]);
    }
  }, [elements, setStoreElements]);

  // Function to generate code from the sketch
  const generateCode = async () => {
    if (isGenerating) {
      console.log('Already generating code, ignoring duplicate request');
      return;
    }
    
    // Get the current elements from the excalidraw instance
    const currentElements = excalidrawRef.current?.getSceneElements();
    
    if (!currentElements) {
      console.error('Could not get elements from excalidraw instance');
      setToast('Error: Could not access drawing elements');
      setTimeout(() => setToast(null), 3000);
      return;
    }
    
    // Use the elements from the excalidraw instance if available, otherwise fall back to state
    const sketchElements = currentElements.length > 0 
      ? currentElements 
      : elements;
    
    console.log(`Using ${sketchElements.length} elements for generation`);
    console.log('Elements sample:', JSON.stringify(sketchElements.slice(0, 1)));
    
    if (!sketchElements || sketchElements.length === 0) {
      console.error('No elements to generate code from');
      setToast('No elements to generate code from. Draw something first!');
      setTimeout(() => setToast(null), 3000);
      return;
    }
    
    try {
      setIsGenerating(true);
      setGenerationError(null);
      setToast('Generating code...');
      
      // Create a timeout to prevent infinite loading - increased to 45 seconds
      const timeoutId = setTimeout(() => {
        console.error('Code generation timed out after 45 seconds');
        setIsGenerating(false);
        setGenerationError('Generation timed out. Please try again with a simpler drawing or fewer elements.');
        setToast('Generation timed out. Try a simpler drawing.');
        setTimeout(() => setToast(null), 5000);
      }, 45000);
      
      // Warn the user if the sketch is complex
      if (sketchElements.length > 50) {
        setToast('Your drawing is complex. Generation may take longer or timeout.');
        // Keep this message a bit longer
        setTimeout(() => {
          if (isGenerating) {
            setToast('Still working on generating your code...');
          }
        }, 5000);
      }
      
      // Pre-process elements to add contextual information
      const processedElements = sketchElements.map((element: any) => {
        // Make a copy to avoid mutating the original
        const processed = { ...element };
        
        // Add element-type specific context
        if (element.type === 'rectangle') {
          processed.uiHint = 'container';
          
          // Check if it's likely a button based on size
          if (element.width < 200 && element.height < 100) {
            processed.uiHint = 'button';
          }
          
          // Check if it might be a card
          if (element.width > 200 && element.height > 200) {
            processed.uiHint = 'card';
          }
          
          // Check if it's likely an input field
          if (element.width > 150 && element.height < 60) {
            processed.uiHint = 'input';
          }
        }
        
        // Add contextual hints for text elements
        if (element.type === 'text') {
          // Guess the role of the text based on context
          if (element.fontSize && element.fontSize > 20) {
            processed.uiHint = 'heading';
          } else if (element.text && element.text.length < 20) {
            processed.uiHint = 'label';
          } else {
            processed.uiHint = 'paragraph';
          }
        }
        
        // Add hints for ellipse/circle elements
        if (element.type === 'ellipse') {
          processed.uiHint = 'button';
          // If it's small, it might be an avatar or icon
          if (element.width < 50 && element.height < 50) {
            processed.uiHint = 'icon';
          }
        }
        
        // Add hints for line elements
        if (element.type === 'line') {
          processed.uiHint = 'divider';
        }
        
        return processed;
      });
      
      // Create a simple unique ID for this code generation
      const genId = `gen_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      
      // Make sure we have a valid user ID
      // First check component state, then store, then session
      const currentUserId = userId || storeUserId || await getCurrentUserId();
      console.log('Using user ID for code generation:', currentUserId || 'unavailable');
      
      const data = {
        sketch_data: processedElements,
        framework: 'react',
        css: 'tailwind',
        user_id: currentUserId || '',  // Send empty string instead of 'anonymous'
        designId: designId || genId
      };
      
      console.log('Sending data to API with ID:', designId || genId);
      console.log(`Sending ${processedElements.length} processed elements`);
      
      // Get the origin for constructing absolute URL
      const host = window.location.origin;
      console.log('Using host:', host);
      
      // Prepare the request
      const requestBody = JSON.stringify(data);
      console.log('Request body (sample):', requestBody.substring(0, 200) + (requestBody.length > 200 ? '...' : ''));
      
      // First try the non-streaming approach for complex drawings
      let useNonStreaming = sketchElements.length > 30;
      
      // If the sketch is complex, try non-streaming first
      if (useNonStreaming) {
        console.log('Sketch is complex, using non-streaming approach first');
        try {
          const nonStreamingData = { ...data, useNonStreaming: true };
          const nonStreamingResponse = await fetch(`${host}/api/generate`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(nonStreamingData),
          });
          
          // If we get a response, process it
          if (nonStreamingResponse.ok) {
            const jsonResult = await nonStreamingResponse.json();
            
            // Clear timeout since we got a response
            clearTimeout(timeoutId);
            
            if (jsonResult.error) {
              console.error('Non-streaming API returned error:', jsonResult.error);
              throw new Error(jsonResult.error);
            }
            
            console.log('Non-streaming API returned successfully');
            
            if (jsonResult.designToken) {
              // Save the design token
              setDesignId(jsonResult.designToken);
              setStoreDesignId(jsonResult.designToken);
            }
            
            if (jsonResult.code) {
              setStoreCode(jsonResult.code);
              setIsGenerating(false);
              setToast('Code generated successfully!');
              setTimeout(() => setToast(null), 3000);
              return;
            }
          } else {
            console.error('Non-streaming API failed with status:', nonStreamingResponse.status);
            // Continue to streaming approach
          }
        } catch (nonStreamingError) {
          console.error('Non-streaming approach failed:', nonStreamingError);
          // Continue to streaming approach
        }
      }
      
      // Make the API call with streaming response as fallback or primary method
      console.log('Starting fetch request to', `${host}/api/generate`);
      let streamingFailed = false;
      
      try {
        // Try the streaming approach
        const response = await fetch(`${host}/api/generate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream'
          },
          body: requestBody,
        });
        
        // Clear the timeout as the request completed
        clearTimeout(timeoutId);
        
        console.log('API response status:', response.status, response.statusText);
        console.log('Response headers:', Object.fromEntries([...response.headers.entries()]));
        
        if (!response.ok) {
          const errorText = await response.text();
          console.error(`API responded with status: ${response.status}`, errorText);
          throw new Error(`API responded with status: ${response.status}. ${errorText}`);
        }
        
        if (!response.body) {
          console.error('API response has no body');
          streamingFailed = true;
        } else {
          // Track all received code and completion status
          let code = '';
          let codeComplete = false;
          let designToken = null;
          let chunksReceived = 0;
          
          const reader = response.body.getReader();
          if (!reader) {
            console.error('Failed to get response reader');
            streamingFailed = true;
          } else {
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) {
                  console.log('Stream finished, code complete, received', chunksReceived, 'chunks');
                  break;
                }
                
                chunksReceived++;
                const chunk = new TextDecoder().decode(value);
                console.log(`Raw chunk ${chunksReceived} received (length ${chunk.length})`, chunk.substring(0, 100) + (chunk.length > 100 ? '...' : ''));
                
                // Handle multiple JSON objects in a single chunk (if they're line-separated)
                const lines = chunk.split('\n').filter(line => line.trim());
                console.log(`Chunk contains ${lines.length} lines`);
                
                for (const line of lines) {
                  try {
                    // Try to parse the line as JSON
                    const data = JSON.parse(line);
                    console.log('Parsed chunk data type:', data.message || (data.code ? 'code' : 'unknown'), 'length:', line.length);
                    
                    if (data.message === 'error') {
                      console.error('Error message received:', data.error);
                      throw new Error(data.error || 'Unknown error in stream');
                    } else if (data.message === 'token' && data.designToken) {
                      console.log('Design token received:', data.designToken);
                      designToken = data.designToken;
                      setDesignId(data.designToken);
                      setStoreDesignId(data.designToken);
                    } else if (data.code) {
                      // Append code chunk
                      code += data.code;
                      console.log(`Code chunk received, size: ${data.code.length}, total size: ${code.length}`);
                      
                      // If this is the last chunk, we're done
                      if (data.isLast) {
                        codeComplete = true;
                        console.log('Final code chunk received, code is complete');
                      }
                      
                      // Update the UI with partial code
                      if (code.length > 0) {
                        setStoreCode(code);
                        // Only set codeComplete when we have complete code
                        if (codeComplete) {
                          setIsGenerating(false);
                          setToast('Code generated successfully!');
                          setTimeout(() => setToast(null), 3000);
                        } else {
                          // Update the toast for partial code
                          setToast(`Receiving code... (${Math.round((data.chunkIndex + 1) / data.totalChunks * 100)}%)`);
                        }
                      }
                    } else if (data.message === 'success') {
                      console.log('Success message received:', data.info);
                      codeComplete = true;
                      if (code.length > 0) {
                        setIsGenerating(false);
                        setToast('Code generated successfully!');
                        setTimeout(() => setToast(null), 3000);
                      }
                    }
                  } catch (jsonError) {
                    console.error('Error parsing chunk JSON:', jsonError);
                    console.error('Problematic chunk:', line);
                  }
                }
              }
              
              // Check if we received complete code
              if (!codeComplete) {
                console.warn('Stream ended but code is not marked as complete');
                streamingFailed = true;
              }
            } catch (readerError) {
              console.error('Stream reading error:', readerError);
              streamingFailed = true;
            }
          }
        }
        
        if (streamingFailed) {
          console.error('Streaming approach failed');
          throw new Error('Failed to read streaming response');
        }
      } catch (error) {
        console.error('API call failed:', error);
        
        // Provide a meaningful error message to the user
        let errorMessage = '';
        if (error instanceof Error && error.message) {
          if (error.message.includes('timed out')) {
            errorMessage = 'Generation timed out. Please try again with a simpler drawing or fewer elements.';
          } else if (error.message.includes('504')) {
            errorMessage = 'Server timeout error. The drawing may be too complex to generate code in the available time.';
          } else {
            errorMessage = `Generation Error: ${error.message}`;
          }
        } else {
          errorMessage = 'Unknown generation error occurred';
        }
        
        setGenerationError(errorMessage);
        setIsGenerating(false);
        setToast(errorMessage);
        setTimeout(() => setToast(null), 5000);
      }
    } catch (topLevelError) {
      console.error('Top-level error in code generation:', topLevelError);
      const errorMsg = topLevelError instanceof Error ? 
        `Error: ${topLevelError.message}` : 
        'Unknown error occurred';
      setGenerationError(errorMsg);
      setIsGenerating(false);
      setToast(errorMsg);
      setTimeout(() => setToast(null), 5000);
    }
  };

  // Watch for URL changes - this is important when DrawPage creates a new design
  useEffect(() => {
    if (urlDesignId && urlDesignId !== designId) {
      setDesignId(urlDesignId);
      setStoreDesignId(urlDesignId);
      setIsLoading(true);
      
      const loadDesignFromUrl = async () => {
        try {
          console.log('URL design ID changed, loading design:', urlDesignId);
          const { data: design, error } = await supabase
            .from('designs')
            .select('id, excalidraw_data, session_id')
            .eq('id', urlDesignId)
            .single();
            
          if (error) {
            console.error('Error loading design from URL change:', error);
            return;
          }
          
          if (design?.excalidraw_data) {
            setElements(design.excalidraw_data);
            setStoreElements(design.excalidraw_data);
            if (design.session_id) {
              setSessionId(design.session_id);
            }
          }
        } catch (err) {
          console.error('Error loading design after URL change:', err);
        } finally {
          setIsLoading(false);
        }
      };
      
      loadDesignFromUrl();
    }
  }, [urlDesignId, designId, setStoreElements, setStoreDesignId]);

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
            setStoreElements(payload.new.excalidraw_data);
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
  }, [userId, designId, setStoreElements]);

  // Save function (removes database functionality)
  const saveToSupabase = useCallback(async (els: readonly any[]) => {
    if (!userId || !designId || isSaving.current) return;
    
    // If using a local design ID, only save to localStorage
    if (designId.startsWith('local-')) {
      saveToLocalStorage(els);
      return;
    }

    isSaving.current = true;
    try {
      // No longer save to database, just update local state
      console.log('Saving drawing to local storage instead of database');
      
      // Save to localStorage as fallback
      saveToLocalStorage(els);
      
      // Clear supabase error since we're not using the database
      if (supabaseError) setSupabaseError(null);
      
      setToast('Drawing saved locally');
      setTimeout(() => setToast(null), 3000);
      
    } catch (error) {
      console.error('Save error:', error);
      setSupabaseError(error as Error);
      
      // Fallback to local storage
      setToast('Saving locally only');
      saveToLocalStorage(els);
    } finally {
      isSaving.current = false;
    }
  }, [userId, designId, saveToLocalStorage, supabaseError, setSupabaseError, setToast]);

  // Auto-save on changes (debounced)
  useEffect(() => {
    if (!elements || elements.length === 0) return;

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
      setStoreDesignId(`local-${newSessionId}`);
      setElements([]);
      setStoreElements([]);
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
          session_id: newSessionId,
          created_by_id: userId
        })
        .select('id')
        .single();
      
      if (error) throw error;
      
      if (newDesign) {
        setDesignId(newDesign.id);
        setStoreDesignId(newDesign.id);
        setElements([]);
        setStoreElements([]);
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
      setStoreDesignId(`local-${newSessionId}`);
      setElements([]);
      setStoreElements([]);
      setToast('Created local drawing session (offline mode)');
      setTimeout(() => setToast(null), 3000);
    }
  };

  const onChangeHandler = useCallback((els: readonly any[]) => {
    setElements(els);
    
    // If this is the first change and not just loading initial data
    if (els.length > 0 && (!elements || elements.length === 0)) {
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
      <div className="h-full w-full relative">
        {/* Toast notifications */}
        {toast && (
          <div className="absolute top-4 right-4 bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded z-50 animate-fade-out">
            {toast}
          </div>
        )}
        
        {/* Supabase connection error toast */}
        {supabaseError && supabaseError instanceof Error && (
          <div className="absolute top-4 left-4 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded z-50 flex items-center gap-2">
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
    <div className="h-full w-full relative">
      {/* Toast notifications */}
      {toast && (
        <div className="absolute top-4 right-4 bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded z-50 animate-fade-out">
          {toast}
        </div>
      )}
      
      {/* Supabase connection error toast */}
      {supabaseError && supabaseError instanceof Error && (
        <div className="absolute top-4 left-4 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded z-50 flex items-center gap-2">
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

      {/* Generate Code button */}
      <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-50">
        <button
          onClick={generateCode}
          disabled={isGenerating || !elements.length}
          className={`flex items-center px-4 py-2 rounded-md shadow-md transition-colors duration-200 ${
            isGenerating ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-500 hover:bg-blue-600 text-white'
          }`}
        >
          {isGenerating ? (
            <>
              <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Generating...
            </>
          ) : (
            'Generate Code'
          )}
        </button>
      </div>
      
      {/* Generation error message */}
      {generationError && (
        <div className="absolute top-16 left-1/2 transform -translate-x-1/2 bg-red-100 border border-red-400 text-red-700 px-4 py-2 rounded z-50 max-w-md">
          <p className="font-bold">Generation Error</p>
          <p className="text-sm">{generationError}</p>
          <button
            className="mt-2 bg-blue-500 hover:bg-blue-700 text-white font-bold py-1 px-3 rounded text-sm"
            onClick={() => {
              // Clear error and restart
              setGenerationError(null);
              setToast('Try drawing again with simpler shapes');
              setTimeout(() => setToast(null), 3000);
            }}
          >
            Try Again
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
              excalidrawAPI={(api) => {
                excalidrawRef.current = api;
                console.log('Excalidraw API loaded:', api);
                console.log('getSceneElements available:', Boolean(api?.getSceneElements));
              }}
              onChange={onChangeHandler}
              initialData={{ elements }}
              UIOptions={{
                canvasActions: {
                  changeViewBackgroundColor: true,
                  clearCanvas: true,
                  export: { saveFileToDisk: true },
                  loadScene: true,
                  saveToActiveFile: true,
                  toggleTheme: true,
                  saveAsImage: true
                }
              }}
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