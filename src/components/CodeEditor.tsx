'use client';

import { useCallback, useEffect, useState, useRef } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import { createClient, updateDesignCode } from '@/lib/supabase/client';
import { useSearchParams } from 'next/navigation';
import { useEditorStore } from '@/lib/store/editor-store';

// Supported frameworks
export type Framework = 'react' | 'vue' | 'svelte';

// Props for the CodeEditor component
interface CodeEditorProps {
  value: string;
  onChange: (newValue: string) => void;
  language: Framework;
}

const supabase = createClient();

// Token keys for design tracking without storing actual code
const DESIGN_TOKEN_KEY = 'devsketch-design-token';
const FORCE_RELOAD_KEY = 'devsketch-force-reload';
const EXCALIDRAW_SESSION_KEY = 'excalidraw-session-id'; // Excalidraw session ID key
// Alternative possible localStorage keys for the session ID
const ALT_SESSION_KEYS = [
  'excalidraw-session',
  'devsketch-session-id',
  'session-id',
  'canvas-session-id'
];

// Function to get localStorage key for a specific design
const getDesignLocalStorageKey = (designId: string) => `code_${designId}`;

// Keys for code storage to check in preference order
const CODE_STORAGE_KEYS = [
  'devsketch-last-code',
  'last_generated_code'
];

// Simplified function to directly get code from localStorage
const getCodeFromLocalStorage = (designId: string | null): string | null => {
  if (!designId) return null;
  
  try {
    // First try the design-specific key
    const designKey = getDesignLocalStorageKey(designId);
    const codeFromDesign = localStorage.getItem(designKey);
    if (codeFromDesign) {
      console.log(`Found code with design key: ${designKey}`);
      return codeFromDesign;
    }
    
    // Try final code key
    const finalCodeKey = `final_code_${designId}`;
    const finalCode = localStorage.getItem(finalCodeKey);
    if (finalCode) {
      console.log(`Found code with final code key: ${finalCodeKey}`);
      return finalCode;
    }

    // Try general keys
    for (const key of CODE_STORAGE_KEYS) {
      const code = localStorage.getItem(key);
      if (code) {
        console.log(`Found code with general key: ${key}`);
        return code;
      }
    }
    
    return null;
  } catch (e) {
    console.error('Error reading from localStorage:', e);
    return null;
  }
};

// Function to extract code from excalidraw_data if the code column doesn't exist
const extractCodeFromExcalidrawData = (excalidrawData: any): string | null => {
  if (!excalidrawData || !Array.isArray(excalidrawData)) return null;
  
  // Look for metadata object that stores code
  const metaItem = excalidrawData.find(item => 
    typeof item === 'object' && 
    item !== null && 
    'type' in item && 
    item.type === '_codeMetadata_' && 
    'code' in item
  );
  
  if (metaItem && 'code' in metaItem) {
    return metaItem.code;
  }
  
  return null;
};

export default function CodeEditor({ value, onChange, language }: CodeEditorProps) {
  const searchParams = useSearchParams();
  const urlDesignId = searchParams.get('id');
  
  // Access the store to get the code generated from the Canvas
  const storeCode = useEditorStore(state => state.code);
  const setStoreCode = useEditorStore(state => state.setCode);
  
  const [code, setCode] = useState<string>('');
  const [userId, setUserId] = useState<string | null>(null);
  const [designId, setDesignId] = useState<string | null>(urlDesignId);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const editorRef = useRef<any>(null);
  const isSaving = useRef(false);
  const initialLoadComplete = useRef(false);
  const hasLoadedFromDatabase = useRef(false);
  const forceRefreshAttempted = useRef(false);
  const hasCheckedStore = useRef(false);
  const supabaseError = useRef<Error | null>(null);
  const loadedDesignIdRef = useRef<string | null>(null);
  // Add a timer ref to ensure loading doesn't get stuck
  const loadingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Function to handle editor mounting
  const handleEditorDidMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    
    // Set up TypeScript definitions based on the current framework
    setupTypeScriptDefinitions(monaco, language);
    
    // If we already have code by this point, set it directly
    if (code) {
      console.log('Setting editor value directly on mount:', code.substring(0, 30) + '...');
      editor.setValue(code);
    } else {
      // Ensure editor is completely empty
      editor.setValue("");
      console.log('Setting editor to empty value');
    }
  };

  // Set up TypeScript definitions for the editor
  const setupTypeScriptDefinitions = (monaco: any, framework: Framework) => {
    // Base React TypeScript definitions
    if (framework === 'react') {
      monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
        jsx: monaco.languages.typescript.JsxEmit.React,
        jsxFactory: 'React.createElement',
        reactNamespace: 'React',
        allowNonTsExtensions: true,
        allowJs: true,
        target: monaco.languages.typescript.ScriptTarget.Latest,
      });
    }
    
    // Vue specific TypeScript definitions
    else if (framework === 'vue') {
      monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
        allowNonTsExtensions: true,
        allowJs: true,
        target: monaco.languages.typescript.ScriptTarget.Latest,
      });
    }
    
    // Svelte specific TypeScript definitions
    else if (framework === 'svelte') {
      monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
        allowNonTsExtensions: true,
        allowJs: true,
        target: monaco.languages.typescript.ScriptTarget.Latest,
      });
    }
  };

  // Store the design token to track which design we're working with
  const saveDesignToken = useCallback((designToken: string) => {
    if (!designToken) return;
    
    try {
      localStorage.setItem(DESIGN_TOKEN_KEY, designToken);
      console.log(`Saved design token: ${designToken}`);
      
      // Create backup tokens in case the main one gets lost
      localStorage.setItem(`${DESIGN_TOKEN_KEY}_backup`, designToken);
      localStorage.setItem(`design_token_${Date.now()}`, designToken);
      
      // Return the token for confirmation
      return designToken;
    } catch (err) {
      console.error('Failed to save design token:', err);
      return null;
    }
  }, []);

  // Get the current design token
  const getDesignToken = useCallback((): string | null => {
    try {
      const token = localStorage.getItem(DESIGN_TOKEN_KEY);
      console.log('Retrieved design token from localStorage:', token);
      return token;
    } catch (err) {
      console.error('Failed to get design token:', err);
      return null;
    }
  }, []);

  // Get design ID from Excalidraw session
  const getDesignIdFromExcalidrawSession = useCallback(async (): Promise<string | null> => {
    try {
      // First approach: Check if we have an excalidraw session ID in localStorage
      let sessionId = localStorage.getItem(EXCALIDRAW_SESSION_KEY);
      
      // If not found, try alternative keys
      if (!sessionId) {
        for (const key of ALT_SESSION_KEYS) {
          const altId = localStorage.getItem(key);
          if (altId) {
            console.log(`Found session ID in alternative key '${key}':`, altId);
            sessionId = altId;
            break;
          }
        }
      }
      
      // Also look for any localStorage keys that might contain canvas IDs
      if (!sessionId) {
        console.log('Looking for any localStorage keys that might contain canvas or design IDs...');
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key) {
            // Look for keys that might be related to canvas or session storage
            if (key.includes('canvas') || key.includes('excalidraw') || key.includes('sketch') || 
                key.includes('session') || key.includes('design')) {
              console.log(`Found potential related localStorage key: ${key}`);
              try {
                const value = localStorage.getItem(key);
                if (value && value.length < 100) {
                  console.log(`Value: ${value}`);
                } else if (value) {
                  console.log(`Value is too long to display (${value.length} chars)`);
                }
              } catch (e) {
                console.log(`Error reading value for key ${key}:`, e);
              }
            }
          }
        }
      }
      
      console.log('Found Excalidraw session ID in localStorage:', sessionId);
      
      if (sessionId) {
        // Try to find a design with this session ID
        // Use .limit(1) instead of .single() to handle 'no rows found' case without error
        console.log(`Querying designs with session_id=${sessionId}`);
        const { data, error } = await supabase
          .from('designs')
          .select('id')
          .filter('session_id', 'eq', sessionId)
          .order('created_at', { ascending: false })
          .limit(1);
          
        if (error) {
          console.error('Error finding design by session ID:', error);
        } else {
          // Check if we got any results back
          if (data && data.length > 0) {
            console.log('Found design ID from session:', data[0].id);
            // Save this ID as the design token for future use
            saveDesignToken(data[0].id);
            return data[0].id;
          } else {
            console.log('No designs found with session_id:', sessionId);
          }
        }
      }
      
      // Second approach: Try to find based on excalidraw backup content
      console.log('Trying to find design from excalidraw backup...');
      const excalidrawBackup = localStorage.getItem('excalidraw-backup');
      
      if (excalidrawBackup) {
        try {
          // Parse the backup data
          const backupData = JSON.parse(excalidrawBackup);
          
          if (Array.isArray(backupData) && backupData.length > 0) {
            // Look for any elements with IDs or other identifiable data
            const firstElement = backupData[0];
            
            if (firstElement && firstElement.id) {
              console.log('Found element ID in backup:', firstElement.id);
              
              // Try to find a design containing this element ID
              const { data: matchingDesigns, error: searchError } = await supabase
                .from('designs')
                .select('id, excalidraw_data')
                .order('created_at', { ascending: false })
                .limit(10);
                
              if (searchError) {
                console.error('Error searching designs:', searchError);
              } else if (matchingDesigns && matchingDesigns.length > 0) {
                // Try to find a design that contains similar elements to our backup
                for (const design of matchingDesigns) {
                  if (design.excalidraw_data && Array.isArray(design.excalidraw_data)) {
                    // Check if any elements match our backup
                    const hasMatch = design.excalidraw_data.some(
                      (elem: any) => elem.id === firstElement.id
                    );
                    
                    if (hasMatch) {
                      console.log('Found matching design with ID:', design.id);
                      saveDesignToken(design.id);
                      return design.id;
                    }
                  }
                }
              }
            }
          }
        } catch (parseError) {
          console.error('Error parsing excalidraw backup:', parseError);
        }
      }
      
      return null;
    } catch (err) {
      console.error('Error retrieving design from excalidraw session:', err);
      return null;
    }
  }, [saveDesignToken]);

  // Check if we need to force a refresh after initial page load
  // This can help with issues where code isn't loading on the first try
  useEffect(() => {
    // Only try this once per session
    if (forceRefreshAttempted.current) return;
    forceRefreshAttempted.current = true;
    
    // Get force reload flag
    const shouldForceReload = localStorage.getItem(FORCE_RELOAD_KEY);
    console.log('Should force reload?', shouldForceReload);
    
    if (!shouldForceReload && urlDesignId) {
      // Set flag to true for next load
      localStorage.setItem(FORCE_RELOAD_KEY, 'true');
      console.log('Setting force reload flag for next load');
      
      // Initial page load - force a refresh to ensure data loads properly
      // setTimeout(() => window.location.reload(), 1000);
    } else {
      // Clear flag after reload
      localStorage.removeItem(FORCE_RELOAD_KEY);
      console.log('Cleared force reload flag');
    }
  }, [urlDesignId]);

  // Fetch user ID and initial data on mount
  useEffect(() => {
    // Skip if we've already loaded this design ID to prevent loops
    if (loadedDesignIdRef.current === urlDesignId) {
      console.log('Skipping load for already loaded design ID:', urlDesignId);
      return;
    }
    
    let mounted = true;
    console.log('Starting fresh load for design ID:', urlDesignId);
    loadedDesignIdRef.current = urlDesignId;
    
    // Create a helper function to safely set loading state
    const safeSetLoading = (loadingState: boolean) => {
      if (mounted && (isLoading !== loadingState)) {
        setIsLoading(loadingState);
      }
    };
    
    // Set initial loading state
    safeSetLoading(true);
    
    // Use these refs to track loading state to avoid loops
    initialLoadComplete.current = false;
    hasLoadedFromDatabase.current = false;
    
    console.log('Starting fetchData in CodeEditor, urlDesignId:', urlDesignId);
    
    const fetchData = async () => {
      try {
        // Reset error state on new attempt
        if (mounted) setError(null);
        
        console.log('Starting code load for editor...');
        
        // Step 1: Try loading from store (fastest, in-memory)
        if (storeCode) {
          console.log('Using code from store:', storeCode.substring(0, 50) + '...');
          setCode(storeCode);
          onChange(storeCode);
          
          // If editor is already mounted, set value directly
          if (editorRef.current) {
            console.log('Setting editor value directly from store');
            editorRef.current.setValue(storeCode);
          }
          
          hasLoadedFromDatabase.current = true;
          hasCheckedStore.current = true;
          initialLoadComplete.current = true;
          safeSetLoading(false);
          return;
        }
        
        // Step 2: Try all localStorage options
        const currentDesignId = urlDesignId || getDesignToken();
        if (currentDesignId) {
          console.log('Looking for code with design ID:', currentDesignId);
          const localCode = getCodeFromLocalStorage(currentDesignId);
          
          if (localCode) {
            console.log('Using code from localStorage:', localCode.substring(0, 50) + '...');
            setCode(localCode);
            onChange(localCode);
            
            // Update the store so it's available for other components
            setStoreCode(localCode);
            
            // If editor is already mounted, set value directly
            if (editorRef.current) {
              console.log('Setting editor value directly from localStorage');
              editorRef.current.setValue(localCode);
            }
            
            hasLoadedFromDatabase.current = true;
            initialLoadComplete.current = true;
            safeSetLoading(false);
            return;
          }
        }
        
        // Step 3: If no design ID, check for any available code in localStorage
        if (!currentDesignId) {
          for (const key of CODE_STORAGE_KEYS) {
            const genericCode = localStorage.getItem(key);
            if (genericCode) {
              console.log(`Using generic code from ${key}:`, genericCode.substring(0, 50) + '...');
              setCode(genericCode);
              onChange(genericCode);
              
              // Update the store
              setStoreCode(genericCode);
              
              // If editor is already mounted, set value directly
              if (editorRef.current) {
                console.log('Setting editor value directly from generic localStorage key');
                editorRef.current.setValue(genericCode);
              }
              
              hasLoadedFromDatabase.current = true;
              initialLoadComplete.current = true;
              safeSetLoading(false);
              return;
            }
          }
        }
        
        console.log('No code found in store or localStorage, trying database...');
        
        // Step 4: Continue with database loading if previous attempts failed
        // Force a direct database load when we have a designId
        let directDesignId = urlDesignId;
        
        // If no URL design ID, try to get from token
        if (!directDesignId) {
          const tokenDesignId = getDesignToken();
          console.log('No URL design ID, checking token:', tokenDesignId);
          if (tokenDesignId) {
            console.log('Using design ID from token:', tokenDesignId);
            directDesignId = tokenDesignId;
            setDesignId(tokenDesignId);
          } else {
            // If no token either, try to get from excalidraw session
            console.log('No design token, checking excalidraw session');
            const sessionDesignId = await getDesignIdFromExcalidrawSession();
            if (sessionDesignId) {
              console.log('Using design ID from excalidraw session:', sessionDesignId);
              directDesignId = sessionDesignId;
              setDesignId(sessionDesignId);
            } else {
              console.warn('No design ID in URL, token, or excalidraw session');
            }
          }
        } else {
          // Save the current design ID as token for future use
          if (urlDesignId) {
            console.log('Saving URL design ID as token:', urlDesignId);
            saveDesignToken(urlDesignId);
          }
        }
        
        // Direct database load attempt - do this before auth checks
        // This makes it more likely code will load even with auth timing issues
        if (directDesignId) {
          try {
            console.log('Attempting direct code load for design:', directDesignId);
            const { data: directCodeData, error: directCodeError } = await supabase
              .from('designs')
              .select('code, excalidraw_data')
              .eq('id', directDesignId)
              .single();
            
            if (!directCodeError && directCodeData) {
              console.log('Direct code load results:', 
                         directCodeData.code ? 'Code found' : 'No code', 
                         directCodeData.excalidraw_data ? 'Excalidraw data found' : 'No excalidraw data');
              
              if (directCodeData.code) {
                console.log('Setting code directly from database:', directCodeData.code.substring(0, 30) + '...');
                setCode(directCodeData.code);
                onChange(directCodeData.code);
                
                // If editor is already mounted, set value directly
                if (editorRef.current) {
                  console.log('Editor already mounted, setting value directly');
                  editorRef.current.setValue(directCodeData.code);
                }
                
                hasLoadedFromDatabase.current = true;
                safeSetLoading(false);
                initialLoadComplete.current = true;
              } else if (directCodeData.excalidraw_data) {
                // Try to extract code from excalidraw_data as fallback
                const extractedCode = extractCodeFromExcalidrawData(directCodeData.excalidraw_data);
                if (extractedCode) {
                  console.log('Setting extracted code directly:', extractedCode.substring(0, 30) + '...');
                  setCode(extractedCode);
                  onChange(extractedCode);
                  
                  // If editor is already mounted, set value directly
                  if (editorRef.current) {
                    console.log('Editor already mounted, setting extracted value directly');
                    editorRef.current.setValue(extractedCode);
                  }
                  
                  hasLoadedFromDatabase.current = true;
                }
              }
            }
          } catch (directLoadError) {
            console.error('Direct code load error:', directLoadError);
            // Continue with normal flow even if direct load fails
          }
        }
        
        // Continue with normal auth flow
        // Check if we have an active session
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        
        if (sessionError) {
          console.error('Session error in CodeEditor component:', sessionError);
          throw sessionError;
        }
        
        if (!session) {
          console.warn('No active session found in CodeEditor component');
          if (mounted) safeSetLoading(false);
          return;
        }
        
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        
        if (authError) {
          console.error('Auth error in CodeEditor component:', authError);
          throw authError;
        }
        
        if (!user) {
          console.warn('No user found in CodeEditor component');
          if (mounted) safeSetLoading(false);
          return;
        }
        
        if (user && mounted) {
          console.log('User authenticated in CodeEditor component:', user.id);
          setUserId(user.id);

          // If we have a design ID from URL, try to load that specific design
          let targetDesignId = urlDesignId;
          
          // If no URL design ID, try to get from token
          if (!targetDesignId) {
            const tokenDesignId = getDesignToken();
            console.log('No URL design ID, checking token:', tokenDesignId);
            if (tokenDesignId) {
              console.log('Using design ID from token:', tokenDesignId);
              targetDesignId = tokenDesignId;
              // Update the designId state
              setDesignId(tokenDesignId);
            } else {
              // If no token either, try to get from excalidraw session
              console.log('No design token, checking excalidraw session');
              const sessionDesignId = await getDesignIdFromExcalidrawSession();
              if (sessionDesignId) {
                console.log('Using design ID from excalidraw session:', sessionDesignId);
                targetDesignId = sessionDesignId;
                setDesignId(sessionDesignId);
              } else {
                console.warn('No design ID in URL, token, or excalidraw session');
              }
            }
          } else {
            // Save the current design ID as token for future use
            if (urlDesignId) {
              console.log('Saving URL design ID as token:', urlDesignId);
              saveDesignToken(urlDesignId);
            }
          }
          
          if (targetDesignId) {
            try {
              console.log('Loading code for design:', targetDesignId);
              
              // Fetch from the database
              console.log('Fetching design data from Supabase...');
              const { data: designData, error: designError } = await supabase
                .from('designs')
                .select('id, code, excalidraw_data')
                .eq('id', targetDesignId)
                .single();
              
              console.log('Database response:', designData ? 'Data received' : 'No data', 
                          designError ? `Error: ${designError.message}` : 'No error');
              
              // Debug the content of the response
              if (designData) {
                console.log('Design data contents:', 
                           'id=' + designData.id,
                           'has code=' + (designData.code ? 'yes' : 'no'), 
                           'has excalidraw_data=' + (designData.excalidraw_data ? 'yes' : 'no'));
                
                if (designData.code) {
                  console.log('Code preview:', designData.code.substring(0, 50) + '...');
                }
              }
                
              if (designError) {
                console.error('Error loading design code:', designError);
                
                // If the error is about the missing code column, try to get code from excalidraw_data
                if (designError.message && designError.message.includes('column') && designError.message.includes('does not exist')) {
                  console.log('Attempting to load code from excalidraw_data...');
                  
                  // Fetch just the excalidraw_data
                  const { data: fallbackData, error: fallbackError } = await supabase
                    .from('designs')
                    .select('id, excalidraw_data')
                    .eq('id', targetDesignId)
                    .single();
                    
                  if (fallbackError) {
                    console.error('Error loading fallback data:', fallbackError);
                    throw fallbackError;
                  }
                  
                  if (fallbackData) {
                    setDesignId(fallbackData.id);
                    
                    // Try to extract code from excalidraw_data
                    const extractedCode = extractCodeFromExcalidrawData(fallbackData.excalidraw_data);
                    if (extractedCode) {
                      console.log('Found code in excalidraw_data:', extractedCode.substring(0, 50) + '...');
                      setCode(extractedCode);
                      onChange(extractedCode);
                      
                      // If editor is already mounted, set value directly
                      if (editorRef.current) {
                        console.log('Setting editor value directly with extracted code');
                        editorRef.current.setValue(extractedCode);
                      }
                      
                      hasLoadedFromDatabase.current = true;
                    } else {
                      console.log('No code found in excalidraw_data, checking store');
                      // Check if we have code from the store before defaulting to empty string
                      if (storeCode) {
                        console.log('Using code from store as fallback:', storeCode.substring(0, 30) + '...');
                        setCode(storeCode);
                        onChange(storeCode);
                        
                        // If editor is already mounted, set value directly
                        if (editorRef.current) {
                          console.log('Setting editor value from store as fallback');
                          editorRef.current.setValue(storeCode);
                        }
                      } else {
                        console.log('No code found in design or store, using empty string');
                        setCode('');  // Explicitly set empty code
                      }
                    }
                    
                    safeSetLoading(false);
                    initialLoadComplete.current = true;
                    return;
                  }
                }
                
                console.log('Showing editor with empty code despite error');
                if (mounted) {
                  safeSetLoading(false);
                  setError(designError instanceof Error ? designError : new Error('Failed to load code from database'));
                }
                initialLoadComplete.current = true;
                return;
              }
              
              if (designData && mounted) {
                setDesignId(designData.id);
                // Save the design ID token for future use
                saveDesignToken(designData.id);
                
                // If code exists in the design data, set it
                if (designData.code) {
                  console.log('Code loaded successfully from database:', designData.code.substring(0, 50) + '...');
                  setCode(designData.code);
                  onChange(designData.code);
                  
                  // If editor is already mounted, set value directly
                  if (editorRef.current) {
                    console.log('Setting editor value directly');
                    editorRef.current.setValue(designData.code);
                  }
                  
                  hasLoadedFromDatabase.current = true;
                } else if (designData.excalidraw_data) {
                  // Try to find code in excalidraw_data as fallback
                  const extractedCode = extractCodeFromExcalidrawData(designData.excalidraw_data);
                  if (extractedCode) {
                    console.log('Code loaded from excalidraw_data:', extractedCode.substring(0, 50) + '...');
                    setCode(extractedCode);
                    onChange(extractedCode);
                    
                    // If editor is already mounted, set value directly
                    if (editorRef.current) {
                      console.log('Setting editor value directly with extracted code');
                      editorRef.current.setValue(extractedCode);
                    }
                    
                    hasLoadedFromDatabase.current = true;
                  } else {
                    console.log('No code found in excalidraw_data, checking store');
                    // Check if we have code from the store before defaulting to empty string
                    if (storeCode) {
                      console.log('Using code from store as fallback:', storeCode.substring(0, 30) + '...');
                      setCode(storeCode);
                      onChange(storeCode);
                      
                      // If editor is already mounted, set value directly
                      if (editorRef.current) {
                        console.log('Setting editor value from store as fallback');
                        editorRef.current.setValue(storeCode);
                      }
                    } else {
                      console.log('No code found in design or store, using empty string');
                      setCode('');  // Explicitly set empty code
                    }
                  }
                } else {
                  console.log('No design data, checking store');
                  // Check if we have code from the store before defaulting to empty string
                  if (storeCode) {
                    console.log('Using code from store as fallback for missing design data:', storeCode.substring(0, 30) + '...');
                    setCode(storeCode);
                    onChange(storeCode);
                    
                    // If editor is already mounted, set value directly
                    if (editorRef.current) {
                      console.log('Setting editor value from store for missing design data');
                      editorRef.current.setValue(storeCode);
                    }
                  } else {
                    console.log('No code found in design or store, using empty string');
                    setCode('');  // Explicitly set empty code
                  }
                }
              }
            } catch (dbError) {
              console.error('Database operation error in CodeEditor component:', dbError);
              setError(dbError instanceof Error ? dbError : new Error('Failed to load code from database'));
            }
          } else {
            console.warn('No target design ID found, skipping code load');
          }
        }
      } catch (error) {
        console.error('Authentication or data loading error in CodeEditor component:', error instanceof Error ? error.message : JSON.stringify(error));
        if (mounted) {
          setError(error instanceof Error ? error : new Error('Authentication failed'));
          safeSetLoading(false);
        }
      } finally {
        if (mounted) {
          console.log('Setting isLoading to false, has store code:', !!storeCode);
          
          // If we have code in the store but not from the database,
          // make sure we use it before finalizing loading
          if (storeCode && !hasLoadedFromDatabase.current) {
            setCode(storeCode);
            onChange(storeCode);
            
            // If editor is already mounted, set value directly
            if (editorRef.current) {
              console.log('Setting editor value from store in finally block');
              editorRef.current.setValue(storeCode);
            }
            
            hasLoadedFromDatabase.current = true;
          }
          
          safeSetLoading(false);
          initialLoadComplete.current = true;
        }
      }
    };

    fetchData();
    
    // Cleanup function
    return () => { 
      mounted = false; 
      
      // If React StrictMode is causing a double-render,
      // we need to reset the loadedDesignIdRef to null for the design
      // we were just loading, so it will load properly on the second render
      if (loadedDesignIdRef.current === urlDesignId) {
        console.log('Resetting loadedDesignIdRef in cleanup');
        loadedDesignIdRef.current = null;
      }
    };
  }, [urlDesignId]); // Only depend on urlDesignId to prevent dependency cycles

  // Update editor value when code changes
  useEffect(() => {
    if (editorRef.current && hasLoadedFromDatabase.current) {
      console.log('Updating editor value to match loaded code');
      editorRef.current.setValue(code);
    }
  }, [code, hasLoadedFromDatabase.current]);

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
          if (isSaving.current) return; // Skip if we're the ones saving
          
          // Check if there's code directly in the payload
          if (payload.new.code) { 
            console.log('Received code update from realtime channel');
            setCode(payload.new.code);
          } 
          // If no code field but there's excalidraw_data, try to extract code from there
          else if (payload.new.excalidraw_data) {
            const extractedCode = extractCodeFromExcalidrawData(payload.new.excalidraw_data);
            if (extractedCode) {
              console.log('Received code update from excalidraw_data metadata');
              setCode(extractedCode);
            }
          }
        })
        .subscribe((status) => {
          if (status === 'CHANNEL_ERROR') {
            setError(new Error('Realtime connection failed'));
            setToast('Realtime updates unavailable');
            setTimeout(() => setToast(null), 3000);
          }
        });
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to subscribe to realtime updates'));
    }

    return () => {
      if (channel) channel.unsubscribe();
    };
  }, [userId, designId]);

  // Verify 'code' column exists in Supabase
  useEffect(() => {
    const verifyCodeColumn = async () => {
      if (!userId || !designId) return;
      
      try {
        // Try to check if the code column exists by querying it specifically
        const { error } = await supabase
          .from('designs')
          .select('code')
          .eq('id', designId)
          .limit(1);
          
        if (error && error.message.includes('column') && error.message.includes('does not exist')) {
          console.warn('Code column does not exist, attempting to create it...');
          
          // Try to create the column using SQL (requires admin privileges)
          try {
            // This will only work if the client has proper permissions
            const { error: sqlError } = await supabase.rpc('add_code_column');
            
            if (sqlError) {
              console.error('Failed to create code column via RPC:', sqlError);
              throw sqlError;
            }
            
            console.log('Successfully created code column');
            
            // Reload the page to use the new column
            window.location.reload();
          } catch (createError) {
            console.error('Failed to create code column:', createError);
            setError(new Error('Database schema error: code column missing. Please contact administrator.'));
          }
        }
      } catch (err) {
        console.error('Error verifying code column:', err);
      }
    };
    
    verifyCodeColumn();
  }, [userId, designId]);

  // Save function (previously used database, now just updates local state)
  const saveToSupabase = useCallback(async (codeValue: string) => {
    if (!userId || !designId || isSaving.current) return;
    
    isSaving.current = true;
    try {
      console.log('Updating local code state for design:', designId);
      
      // Save current design ID as token
      saveDesignToken(designId);
      
      // Ensure code is a string
      const safeCodeValue = codeValue || '';
      
      // Save code to all storage mechanisms for redundancy
      // 1. Store state
      setStoreCode(safeCodeValue);
      
      // 2. Local component state
      setCode(safeCodeValue);
      onChange(safeCodeValue);
      
      // 3. localStorage with all possible keys
      try {
        localStorage.setItem(`code_${designId}`, safeCodeValue);
        localStorage.setItem('last_generated_code', safeCodeValue);
        localStorage.setItem('devsketch-last-code', safeCodeValue);
        localStorage.setItem(`final_code_${designId}`, safeCodeValue);
        console.log('Code saved to all localStorage keys');
      } catch (storageError) {
        console.error('Failed to save to localStorage:', storageError);
      }
      
      // Clear error on successful update
      if (supabaseError.current) supabaseError.current = null;
      
      setToast('Code updated locally');
      setTimeout(() => setToast(null), 3000);
      
    } catch (error) {
      console.error('Local state update error:', error);
      
      // More informative error message
      const errorMessage = error instanceof Error 
        ? `Failed to update code: ${error.message}` 
        : 'Failed to update code locally';
        
      setError(new Error(errorMessage));
      
      // Still update local state even if there's an error
      setCode(codeValue);
      
      // Try to notify parent of change even if update fails
      try {
        onChange(codeValue);
      } catch (e) {
        console.error('Failed to notify parent of code change:', e);
      }
    } finally {
      isSaving.current = false;
    }
  }, [userId, designId, onChange, saveDesignToken, supabaseError, setStoreCode]);

  // Auto-save on changes (debounced)
  useEffect(() => {
    if (!code || !designId || !initialLoadComplete.current) return;

    const timer = setTimeout(() => {
      if (userId && designId) {
        saveToSupabase(code);
      }
    }, 1000);

    return () => clearTimeout(timer);
  }, [code, saveToSupabase, userId, designId]);

  // Handle changes from the Monaco editor
  const handleEditorChange = useCallback((value: string | undefined) => {
    if (value !== undefined) {
      setCode(value);
      
      // Also update the parent via onChange
      if (onChange) {
        onChange(value);
      }
      
      // Save to localStorage for backup
      try {
        if (designId) {
          localStorage.setItem(`code_${designId}`, value);
        }
        localStorage.setItem('last_generated_code', value);
      } catch (e) {
        console.warn('Failed to save editor change to localStorage:', e);
      }
    }
  }, [designId, onChange]);

  // Get the language mode for Monaco based on the framework
  const getLanguageMode = (framework: Framework): string => {
    switch (framework) {
      case 'react':
        return 'typescript';
      case 'vue':
        return 'javascript';
      case 'svelte':
        return 'javascript';
      default:
        return 'typescript';
    }
  };

  // Helper function to get proper file extension based on framework
  const getFileExtension = (framework: Framework): string => {
    switch (framework) {
      case 'react':
        return 'tsx';
      case 'vue':
        return 'vue';
      case 'svelte':
        return 'svelte';
      default:
        return 'tsx';
    }
  };

  // Force reload function
  const forceReloadCode = useCallback(async () => {
    if (!designId) {
      setToast('No design ID available');
      setTimeout(() => setToast(null), 3000);
      return;
    }
    
    setIsLoading(true);
    setToast('Reloading code...');
    
    try {
      console.log('Force reloading code for design:', designId);
      
      const { data: designData, error: designError } = await supabase
        .from('designs')
        .select('code, excalidraw_data')
        .eq('id', designId)
        .single();
        
      if (designError) throw designError;
      
      if (designData) {
        if (designData.code) {
          console.log('Force reload: Code loaded successfully:', designData.code.substring(0, 50) + '...');
          setCode(designData.code);
          onChange(designData.code);
          
          // Set value directly on editor
          if (editorRef.current) {
            editorRef.current.setValue(designData.code);
          }
          
          setToast('Code reloaded successfully');
        } else if (designData.excalidraw_data) {
          const extractedCode = extractCodeFromExcalidrawData(designData.excalidraw_data);
          if (extractedCode) {
            console.log('Force reload: Extracted code:', extractedCode.substring(0, 50) + '...');
            setCode(extractedCode);
            onChange(extractedCode);
            
            // Set value directly on editor
            if (editorRef.current) {
              editorRef.current.setValue(extractedCode);
            }
            
            setToast('Code reloaded from excalidraw data');
          } else {
            setToast('No code found for this design');
          }
        } else {
          setToast('No code found for this design');
        }
      } else {
        setToast('Design not found');
      }
    } catch (error) {
      console.error('Force reload error:', error);
      setToast('Failed to reload code');
      setError(error instanceof Error ? error : new Error('Failed to reload code'));
    } finally {
      setIsLoading(false);
      setTimeout(() => setToast(null), 3000);
    }
  }, [designId, onChange]);

  // Debug function to show localStorage and attempt session lookup
  const debugSessionInfo = useCallback(async () => {
    try {
      setToast('Checking localStorage and sessions...');
      
      // Get all relevant localStorage items
      let sessionId = localStorage.getItem(EXCALIDRAW_SESSION_KEY);
      const altSessions: Record<string, string> = {};
      
      // Check all alternative session keys
      for (const key of ALT_SESSION_KEYS) {
        const altId = localStorage.getItem(key);
        if (altId) {
          altSessions[key] = altId;
          if (!sessionId) {
            sessionId = altId;
          }
        }
      }
      
      const backupData = localStorage.getItem('excalidraw-backup');
      const designToken = localStorage.getItem(DESIGN_TOKEN_KEY);
      
      console.log('------ DEBUG SESSION INFO ------');
      console.log('Excalidraw Session ID:', sessionId);
      console.log('Alternative Session IDs:', altSessions);
      console.log('Design Token:', designToken);
      console.log('Has Excalidraw Backup:', backupData ? 'Yes' : 'No');
      
      // Let's check all localStorage keys to help debugging
      console.log('All localStorage items:');
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) {
          const value = localStorage.getItem(key);
          console.log(`- ${key}: ${value?.substring(0, 50)}${value && value.length > 50 ? '...' : ''}`);
        }
      }
      
      if (sessionId) {
        // Try to find designs with this session ID
        console.log(`Querying all designs with session_id=${sessionId}`);
        const { data, error } = await supabase
          .from('designs')
          .select('id, created_at')
          .filter('session_id', 'eq', sessionId)
          .order('created_at', { ascending: false });
          
        if (error) {
          console.error('Error finding designs by session ID:', error);
          setToast('Error querying designs: ' + error.message);
        } else {
          // Check if we got any results back
          if (data && data.length > 0) {
            console.log(`Found ${data.length} designs with this session ID:`);
            data.forEach(design => {
              console.log(`- Design ID: ${design.id}, Created: ${design.created_at}`);
            });
            
            // Try to load the most recent design
            const mostRecent = data[0];
            if (mostRecent && mostRecent.id) {
              console.log('Attempting to load most recent design:', mostRecent.id);
              saveDesignToken(mostRecent.id);
              setDesignId(mostRecent.id);
              forceReloadCode();
            }
          } else {
            console.log('No designs found with session_id:', sessionId);
            setToast('No designs found with this session ID');
          }
        }
      } else {
        setToast('No session ID found in localStorage');
      }
      
      setTimeout(() => setToast(null), 3000);
    } catch (err) {
      console.error('Debug error:', err);
      setToast('Error during debug');
      setTimeout(() => setToast(null), 3000);
    }
  }, [forceReloadCode, saveDesignToken]);

  // Make sure to check the Zustand store for code
  useEffect(() => {
    if (storeCode && !hasCheckedStore.current) {
      console.log('Using code from store:', storeCode.substring(0, 30) + '...');
      setCode(storeCode);
      onChange(storeCode);
      
      // If editor is already mounted, set value directly
      if (editorRef.current) {
        console.log('Setting editor value from store directly');
        editorRef.current.setValue(storeCode);
      }
      
      hasCheckedStore.current = true;
      if (isLoading) {
        setIsLoading(false);
      }
    }
  }, [storeCode, isLoading, onChange]);

  // Update when store code changes
  useEffect(() => {
    if (storeCode && storeCode !== code) {
      console.log('Updating code from store change:', storeCode.substring(0, 30) + '...');
      setCode(storeCode);
      onChange(storeCode);
      
      // If editor is already mounted, set value directly
      if (editorRef.current) {
        console.log('Setting editor value from store update');
        editorRef.current.setValue(storeCode);
      }
    }
  }, [storeCode, code, onChange]);

  // Show an info message if code is empty after loading
  useEffect(() => {
    if (!isLoading && initialLoadComplete.current && code === '' && !hasLoadedFromDatabase.current) {
      console.log('Code is empty after loading completed');
      setToast('No code found for this sketch. Click "Generate Code" in the canvas view to get started.');
      setTimeout(() => setToast(null), 5000); // Show for 5 seconds
    }
  }, [isLoading, code]);

  // Add a safety timeout to prevent loading state from getting stuck
  useEffect(() => {
    // If we're loading, set a timeout to force loading to complete
    if (isLoading) {
      loadingTimeoutRef.current = setTimeout(() => {
        console.log('Loading timeout reached, forcing loading state to complete');
        setIsLoading(false);
        
        // If we don't have code by this point, set empty code
        if (!code && !storeCode) {
          console.log('No code available after timeout, showing empty editor');
          setCode('');
          
          // Show a helpful toast
          setToast('Click "Generate Code" in the canvas to create code from your drawing.');
          setTimeout(() => setToast(null), 5000);
        }
        
        initialLoadComplete.current = true;
      }, 3000); // 3 seconds timeout - reduced from 8 seconds
    } else if (loadingTimeoutRef.current) {
      // Clear the timeout if loading completes normally
      clearTimeout(loadingTimeoutRef.current);
      loadingTimeoutRef.current = null;
    }
    
    // Clean up the timeout on unmount
    return () => {
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current);
        loadingTimeoutRef.current = null;
      }
    };
  }, [isLoading, code, storeCode]);

  // Fast initialize - immediately show empty editor if no code is available
  useEffect(() => {
    if (isLoading && !code && !storeCode && !hasLoadedFromDatabase.current) {
      // If we're just starting and have no code, show empty editor fast
      const quickInit = setTimeout(() => {
        console.log('Quick initialization: showing empty editor');
        setIsLoading(false);
        initialLoadComplete.current = true;
      }, 1000); // Show empty editor after 1 second
      
      return () => clearTimeout(quickInit);
    }
  }, [isLoading, code, storeCode, hasLoadedFromDatabase]);

  return (
    <div className="w-full h-full bg-white relative">
      {/* Display toast messages */}
      {toast && (
        <div className="absolute bottom-4 right-4 bg-black text-white px-4 py-2 rounded-md z-50">
          {toast}
        </div>
      )}
      
      {/* Display loading state */}
      {isLoading && (
        <div className="absolute inset-0 bg-white bg-opacity-70 flex items-center justify-center z-40">
          <div className="flex flex-col items-center">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500 mb-4"></div>
            <p>Loading editor...</p>
          </div>
        </div>
      )}
      
      {/* Display error message but keep editor visible */}
      {error && (
        <div className="absolute top-4 left-4 right-4 bg-red-100 text-red-800 p-4 rounded-md z-30">
          <p className="font-bold">Error: {error.message}</p>
          <p className="text-sm mt-1">The editor is still available for use, but changes may not be saved.</p>
          <div className="flex space-x-2 mt-2">
            <button 
              className="bg-red-800 text-white px-4 py-1 rounded-md"
              onClick={() => window.location.reload()}
            >
              Retry
            </button>
            <button 
              className="bg-blue-800 text-white px-4 py-1 rounded-md"
              onClick={() => {
                if (designId) saveDesignToken(designId);
                window.location.href = `/draw?id=${designId}`;
              }}
            >
              Reload Design
            </button>
            <button 
              className="bg-green-800 text-white px-4 py-1 rounded-md"
              onClick={forceReloadCode}
            >
              Force Load Code
            </button>
          </div>
        </div>
      )}
      
      {/* Always render the editor - now with a wrapping div with explicit dimensions */}
      <div style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 }}>
        {/* Show a subtle hint when editor is empty */}
        {(!code || code === '') && !isLoading && (
          <div className="absolute top-4 left-4 bg-blue-100 border border-blue-400 text-blue-700 px-4 py-3 rounded z-50 opacity-80 pointer-events-none">
            <p>Draw on the canvas and click "Generate Code" to create code.</p>
          </div>
        )}
        
        <Editor
          height="100%"
          width="100%"
          defaultLanguage={getLanguageMode(language)}
          defaultValue=""
          value={code || ""}
          path={`file.${getFileExtension(language)}`}
          onChange={handleEditorChange}
          onMount={handleEditorDidMount}
          loading={<div className="p-4">Loading Monaco Editor...</div>}
          options={{
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            fontSize: 14,
            automaticLayout: true,
            lineNumbers: 'on',
            wordWrap: 'on',
            folding: true,
          }}
        />
      </div>
    </div>
  );
} 