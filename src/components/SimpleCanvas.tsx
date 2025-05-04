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

export default function SimpleCanvas() {
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
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Function to generate code from the sketch
  const generateCode = async () => {
    if (!elements.length) {
      setToastMessage('Please draw something first');
      setTimeout(() => setToastMessage(null), 3000);
      return;
    }
    
    setIsGenerating(true);
    setGenerationError(null);
    
    try {
      console.log('Starting code generation with elements:', elements.length);
      
      // Pre-process elements to add contextual information
      const processedElements = elements.map(element => {
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
      
      // Add user ID and design ID to request if available
      const data = {
        sketch_data: processedElements,
        framework: 'react', // Default to React for now
        css: 'tailwind',
        user_id: userId,
        designId: designId
      };
      
      console.log('Sending enhanced data to API:', JSON.stringify(data).substring(0, 200) + '...');
      
      // Get the origin for constructing absolute URL
      const host = window.location.origin;
      console.log('Using host:', host);
      
      // Make the API call with a simplified approach
      const response = await fetch(`${host}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });
      
      if (!response.ok) {
        throw new Error(`API responded with status: ${response.status}`);
      }
      
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Failed to get response reader');
      }
      
      // Track all received code and completion status
      let code = '';
      let codeComplete = false;
      let designToken = null;
      
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            console.log('Stream finished, code complete');
            break;
          }
          
          const chunk = new TextDecoder().decode(value);
          console.log('Raw chunk received:', chunk);
          
          // Handle multiple JSON objects in a single chunk (if they're line-separated)
          const lines = chunk.split('\n').filter(line => line.trim());
          
          for (const line of lines) {
            try {
              // Try to parse the line as JSON
              const data = JSON.parse(line);
              console.log('Parsed chunk data:', data);
              
              if (data.message === 'error') {
                console.error('Error message received:', data.error);
                setGenerationError(data.error || 'Unknown error');
                continue;
              }
              
              // Check for design token
              if (data.message === 'token' && data.designToken) {
                console.log('Design token received:', data.designToken);
                designToken = data.designToken;
                localStorage.setItem('design_token', data.designToken);
                // Create backup of the token
                localStorage.setItem(`design_token_backup_${Date.now()}`, data.designToken);
              }
              
              if (data.code) {
                console.log('Code chunk received, length:', data.code.length);
                code += data.code;
                setStoreCode(code);
                setStoreUserId(userId);
                
                if (data.isLast) {
                  console.log('Final code chunk received, length:', code.length);
                  codeComplete = true;
                }
              }
              
              if (data.message === 'success') {
                console.log('Success message received');
                setToastMessage('Code generated successfully');
                setTimeout(() => setToastMessage(null), 3000);
              }
              
              if (data.message === 'end') {
                console.log('End message received');
              }
            } catch (lineError) {
              console.error('Error parsing line:', lineError, 'Raw line:', line);
            }
          }
        }
        
        // Final check after all chunks are processed
        if (code) {
          console.log('Total code assembled:', code.length);
          if (!codeComplete) {
            console.log('Code assembly complete but no isLast flag received');
          }
          
          // If we received a design token, make sure it's saved properly
          if (designToken) {
            console.log('Saving design token after successful code generation');
            // Save in multiple locations for redundancy
            localStorage.setItem('design_token', designToken);
            localStorage.setItem('design_token_main', designToken);
            localStorage.setItem(`design_token_${Date.now()}`, designToken);
            
            setToastMessage('Code generated and token saved');
            setTimeout(() => setToastMessage(null), 3000);
          } else {
            console.warn('No design token received from API');
            // Generate a backup token
            const backupToken = `design_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
            localStorage.setItem('design_token', backupToken);
            localStorage.setItem(`design_token_backup_${Date.now()}`, backupToken);
            
            setToastMessage('Code generated but no token received');
            setTimeout(() => setToastMessage(null), 3000);
          }
        } else {
          console.warn('No code was assembled from the response');
          throw new Error('No code was generated');
        }
        
      } catch (fetchError) {
        console.error('Fetch error:', fetchError);
        setGenerationError('Failed to fetch or process the response');
      }
    } catch (error) {
      console.error('Error generating code:', error);
      setGenerationError('Failed to generate code');
      setToastMessage('Failed to generate code');
      setTimeout(() => setToastMessage(null), 3000);
    } finally {
      setIsGenerating(false);
    }
  };

  // Handle Excalidraw error
  const handleExcalidrawError = (error: Error) => {
    console.error('Excalidraw rendering error:', error);
    setExcalidrawError(error);
  };

  const onChangeHandler = useCallback((els: readonly any[]) => {
    setElements(els);
    
    // If this is the first change and not just loading initial data
    if (els.length > 0 && (!elements || elements.length === 0)) {
      // Log that we have elements now
      console.log('First elements detected:', els.length);
    }
  }, [elements]);

  // Basic UI for testing
  return (
    <div className="h-full w-full relative">
      {/* Toast notifications */}
      {toastMessage && (
        <div className="absolute top-4 right-4 bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded z-50">
          {toastMessage}
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
        </div>
      )}

      {/* Excalidraw component */}
      <div className="h-full w-full relative">
        {excalidrawError ? (
          <div className="flex items-center justify-center h-full">
            <div className="p-4 bg-red-100 rounded border border-red-300">
              <h3 className="text-lg font-bold text-red-700">Canvas Error</h3>
              <p>{excalidrawError.message}</p>
              <button 
                className="mt-2 px-4 py-2 bg-blue-500 text-white rounded"
                onClick={() => setExcalidrawError(null)}
              >
                Try Again
              </button>
            </div>
          </div>
        ) : (
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
        )}
      </div>
    </div>
  );
}