import { create } from 'zustand';
import { Framework } from '@/components/CodeEditor';
import { createClient } from '@/lib/supabase/client';

const supabase = createClient();

interface EditorState {
  // Canvas related state
  elements: any[];
  setElements: (elements: any[]) => void;
  
  // Code editor related state
  code: string;
  setCode: (code: string) => void;
  
  // Shared state
  currentFramework: Framework;
  setCurrentFramework: (framework: Framework) => void;
  designId: string | null;
  setDesignId: (id: string | null) => void;
  userId: string | null;
  setUserId: (id: string | null) => void;
  
  // Supabase functions
  updateSupabaseCode: (code: string) => Promise<void>;
  updateSupabaseElements: (elements: any[]) => Promise<void>;
  saveDesign: () => Promise<void>;
  loadDesign: (id: string) => Promise<void>;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  // Canvas related state
  elements: [],
  setElements: (elements) => set({ elements }),
  
  // Code editor related state
  code: '',
  setCode: (code) => {
    // Update store state - don't set default code for empty strings
    const safeCode = code || '';
    set({ code: safeCode });
    
    // Also save to local storage for persistence
    try {
      const { designId } = get();
      if (designId) {
        localStorage.setItem(`code_${designId}`, safeCode);
      }
      // Always save the most recent code
      localStorage.setItem('last_generated_code', safeCode);
    } catch (e) {
      console.warn('Failed to save code to localStorage:', e);
    }
  },
  
  // Shared state
  currentFramework: 'react' as Framework,
  setCurrentFramework: (framework) => set({ currentFramework: framework }),
  designId: null,
  setDesignId: (id) => set({ designId: id }),
  userId: null,
  setUserId: (id) => set({ userId: id }),
  
  // Supabase functions
  updateSupabaseCode: async (code) => {
    const { designId, userId } = get();
    const safeCode = code || '';
    
    if (!designId || !userId) {
      // Save code to store even if we don't have IDs yet
      set({ code: safeCode });
      
      // Save to localStorage if possible
      try {
        localStorage.setItem('last_generated_code', safeCode);
        if (designId) {
          localStorage.setItem(`code_${designId}`, safeCode);
        }
      } catch (e) {
        console.warn('Failed to save code to localStorage:', e);
      }
      return;
    }
    
    // Save to local storage first for reliability
    try {
      localStorage.setItem(`code_${designId}`, safeCode);
      localStorage.setItem('last_generated_code', safeCode);
    } catch (e) {
      console.warn('Failed to save code to localStorage:', e);
    }
    
    // Update store state
    set({ code: safeCode });
    
    try {
      // First try: update using match() instead of eq()
      const { error: firstError } = await supabase
        .from('designs')
        .update({ code })
        .match({ id: designId });
        
      if (!firstError) {
        // Success with first attempt
        return;
      }
      
      console.error('First update attempt failed:', firstError);
      
      // Second try: update without updated_at using eq()
      const { error: secondError } = await supabase
        .from('designs')
        .update({ code })
        .eq('id', designId);
        
      if (!secondError) {
        // Success with second attempt
        return;
      }
      
      console.error('Second update attempt failed:', secondError);
      
      // Third try: use the updateDesignCode helper from client.ts
      const { updateDesignCode } = await import('@/lib/supabase/client');
      const { success, error } = await updateDesignCode(supabase, designId, code);
      
      if (success) {
        return;
      }
      
      throw error || new Error('All update attempts failed');
    } catch (error) {
      console.error('Failed to update code in Supabase:', error);
    }
  },
  
  updateSupabaseElements: async (elements) => {
    const { designId, userId } = get();
    if (!designId || !userId) return;
    
    try {
      await supabase
        .from('designs')
        .update({
          excalidraw_data: elements,
          updated_at: new Date().toISOString()
        })
        .eq('id', designId);
        
      // Update local state
      set({ elements });
    } catch (error) {
      console.error('Failed to update elements in Supabase:', error);
    }
  },
  
  saveDesign: async () => {
    const { designId, userId, elements, code, currentFramework } = get();
    if (!userId) return;
    
    try {
      if (designId) {
        // Update existing design
        await supabase
          .from('designs')
          .update({
            excalidraw_data: elements,
            code: code,
            updated_at: new Date().toISOString()
          })
          .eq('id', designId);
      } else {
        // Create new design
        const { data } = await supabase
          .from('designs')
          .insert({
            user_id: userId,
            excalidraw_data: elements,
            code: code,
            session_id: crypto.randomUUID(),
            created_by_id: userId
          })
          .select('id')
          .single();
          
        if (data?.id) {
          set({ designId: data.id });
        }
      }
    } catch (error) {
      console.error('Failed to save design to Supabase:', error);
    }
  },
  
  loadDesign: async (id) => {
    try {
      const { data } = await supabase
        .from('designs')
        .select('id, excalidraw_data, code')
        .eq('id', id)
        .single();
        
      if (data) {
        set({
          designId: data.id,
          elements: data.excalidraw_data || [],
          code: data.code || ''
        });
      }
    } catch (error) {
      console.error('Failed to load design from Supabase:', error);
    }
  }
})); 