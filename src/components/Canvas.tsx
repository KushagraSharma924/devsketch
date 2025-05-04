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
      
      // Create a timeout to prevent infinite loading
      const timeoutId = setTimeout(() => {
        console.error('Code generation timed out after 30 seconds');
        setIsGenerating(false);
        setGenerationError('Generation timed out. Please try again.');
        setToast('Generation timed out. Please try again.');
        setTimeout(() => setToast(null), 3000);
      }, 30000);
      
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
      
      // Make the API call with streaming response first
      console.log('Starting fetch request to', `${host}/api/generate`);
      let streamingFailed = false;
      
      try {
        // Try the streaming approach first
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
                      setGenerationError(data.error || 'Unknown error');
                      continue;
                    }
                    
                    // Check for design token
                    if (data.message === 'token' && data.designToken) {
                      console.log('Design token received:', data.designToken);
                      designToken = data.designToken;
                      
                      // Save design token for later use - use multiple storage mechanisms for reliability
                      localStorage.setItem('design_token', data.designToken);
                      localStorage.setItem('devsketch-design-token', data.designToken);
                      localStorage.setItem(DESIGN_TOKEN_KEY, data.designToken);
                      localStorage.setItem(`design_token_backup_${Date.now()}`, data.designToken);
                      
                      // Update store design ID if we don't have one yet
                      if (!designId) {
                        setDesignId(data.designToken);
                        setStoreDesignId(data.designToken);
                      }
                    }
                    
                    if (data.code) {
                      console.log('Code chunk received, length:', data.code.length);
                      
                      // Add this chunk to our accumulated code
                      const prevLength = code.length;
                      code += data.code;
                      console.log(`Added ${data.code.length} chars, code now ${prevLength} -> ${code.length} chars`);
                      
                      // Update the store and save to localStorage with each chunk for redundancy
                      setStoreCode(code);
                      
                      // Save the code to multiple locations to ensure it's available
                      try {
                        const tokenToUse = designToken || designId || genId;
                        localStorage.setItem('last_generated_code', code);
                        localStorage.setItem(`code_${tokenToUse}`, code);
                        localStorage.setItem('devsketch-last-code', code);
                        console.log(`Saved code chunk to localStorage with key code_${tokenToUse}`);
                      } catch (storageError) {
                        console.error('Failed to save code to localStorage:', storageError);
                      }
                      
                      if (data.isLast) {
                        console.log('Final code chunk received, total length:', code.length);
                        console.log('Code preview:', code.substring(0, 200) + (code.length > 200 ? '...' : ''));
                        codeComplete = true;
                        
                        // Ensure the final code is saved to the store
                        setStoreCode(code);
                        setToast('Code generated successfully');
                        setTimeout(() => setToast(null), 3000);
                        console.log('Store updated with complete code');
                      }
                    }
                  } catch (parseError) {
                    console.error('Error parsing JSON from stream:', parseError, 'on line:', line);
                    
                    // If we get consistent parsing errors, set flag to try non-streaming
                    if (chunksReceived === 1) {
                      streamingFailed = true;
                      break;
                    }
                  }
                }
                
                if (streamingFailed) {
                  console.log('Stream response parsing failed, will try non-streaming fallback');
                  break;
                }
              }
              
              console.log('Stream reading complete, code generated:', code ? 'Yes' : 'No');
              
              // If we have code or streaming worked properly, we're done
              if (code || !streamingFailed) {
                if (code) {
                  // We got some code, save it to all storage mechanisms
                  console.log('Final code received, total length:', code.length);
                  console.log('Code sample:', code.substring(0, 100) + (code.length > 100 ? '...' : ''));
                  
                  setStoreCode(code);
                  setToast('Code generated successfully');
                  setTimeout(() => setToast(null), 3000);
                } else if (codeComplete === false) {
                  console.error('No code received from API');
                  // Let error messages from the API drive the UI
                  console.log('Keeping editor empty for this error case');
                  setGenerationError('No code was generated. The API did not return any code.');
                }
                
                setIsGenerating(false);
                return; // Exit here if streaming worked
              }
            } catch (streamError) {
              console.error('Stream processing error:', streamError);
              streamingFailed = true;
            }
          }
        }
        
        // If we get here and streaming failed, use non-streaming fallback
        if (streamingFailed) {
          console.log('Trying non-streaming fallback API request');
          
          // Modify data to request non-streaming response
          const nonStreamingData = {
            ...data,
            useNonStreaming: true
          };
          
          try {
            const nonStreamingResponse = await fetch(`${host}/api/generate`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
              },
              body: JSON.stringify(nonStreamingData),
            });
            
            if (!nonStreamingResponse.ok) {
              throw new Error(`Non-streaming API call failed with status: ${nonStreamingResponse.status}`);
            }
            
            const result = await nonStreamingResponse.json();
            console.log('Non-streaming response received:', result);
            
            if (result.error) {
              setGenerationError(result.error || 'Unknown error in non-streaming response');
            } else if (result.code) {
              console.log('Received code via non-streaming API, length:', result.code.length);
              setStoreCode(result.code);
              
              // Save design token if available
              if (result.designToken) {
                localStorage.setItem('design_token', result.designToken);
                localStorage.setItem('devsketch-design-token', result.designToken);
                localStorage.setItem(DESIGN_TOKEN_KEY, result.designToken);
                
                // Update store design ID if we don't have one yet
                if (!designId) {
                  setDesignId(result.designToken);
                  setStoreDesignId(result.designToken);
                }
              }
              
              // Save the code to localStorage
              try {
                const tokenToUse = result.designToken || designId || genId;
                localStorage.setItem('last_generated_code', result.code);
                localStorage.setItem(`code_${tokenToUse}`, result.code);
                localStorage.setItem('devsketch-last-code', result.code);
              } catch (storageError) {
                console.error('Failed to save code to localStorage:', storageError);
              }
              
              setToast('Code generated successfully (non-streaming)');
              setTimeout(() => setToast(null), 3000);
            } else {
              setGenerationError('No code was generated from the non-streaming API.');
            }
          } catch (nonStreamingError) {
            console.error('Non-streaming API error:', nonStreamingError);
            setGenerationError('Failed to generate code (non-streaming): ' + 
              (nonStreamingError instanceof Error ? nonStreamingError.message : 'Unknown error'));
          }
        }
      } catch (error) {
        console.error('Error in generation process:', error);
        setGenerationError('Failed to generate code: ' + (error instanceof Error ? error.message : 'Unknown error'));
        setToast('Failed to generate code');
        setTimeout(() => setToast(null), 3000);
      } finally {
        setIsGenerating(false);
        console.log('Code generation process complete');
      }
    } catch (error) {
      console.error('Error in generation process:', error);
      setGenerationError('Failed to generate code: ' + (error instanceof Error ? error.message : 'Unknown error'));
      setToast('Failed to generate code');
      setTimeout(() => setToast(null), 3000);
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