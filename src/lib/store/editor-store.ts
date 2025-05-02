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
  setCode: (code) => set({ code }),
  
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
    if (!designId || !userId) return;
    
    try {
      await supabase
        .from('designs')
        .update({
          code: code,
          updated_at: new Date().toISOString()
        })
        .eq('id', designId);
        
      // Update local state
      set({ code });
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