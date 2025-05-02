import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { Database } from './types'

// Environment variables
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

/**
 * Create a Supabase client for use in the browser
 */
export const createClient = () => {
  return createSupabaseClient<Database>(supabaseUrl, supabaseAnonKey)
}

/**
 * Attempt to update a design's code directly, handling potential column missing errors
 */
export const updateDesignCode = async (
  supabase: ReturnType<typeof createClient>,
  designId: string, 
  code: string
): Promise<{ success: boolean; error?: any }> => {
  try {
    // First try normal update with updated_at
    const { error: firstError } = await supabase
      .from('designs')
      .update({
        code: code,
        updated_at: new Date().toISOString()
      })
      .eq('id', designId);
      
    if (!firstError) {
      return { success: true };
    }
    
    // If error is about updated_at column, try without it
    if (firstError.message && firstError.message.includes('updated_at')) {
      console.log('updated_at column error detected, trying without updating timestamp');
      
      const { error: retryError } = await supabase
        .from('designs')
        .update({ code: code })
        .eq('id', designId);
        
      if (!retryError) {
        return { success: true };
      }
      
      // If still failing, it might be the code column
      if (retryError.message && retryError.message.includes('column') && 
         (retryError.message.includes('code') || retryError.message.includes('does not exist'))) {
        // Fall through to the excalidraw_data approach below
      } else {
        // Different error, return it
        return { success: false, error: retryError };
      }
    }
    
    // If there's a column missing error, try fallback approach with excalidraw_data
    const error = firstError;
    if (error.message && (error.message.includes('column') || error.message.includes('does not exist'))) {
      console.log('Column missing error detected, attempting alternative approach');
      
      // Try inserting the code as a JSON field in excalidraw_data
      const { data, error: getError } = await supabase
        .from('designs')
        .select('excalidraw_data')
        .eq('id', designId)
        .single();
        
      if (getError) throw getError;
      
      let updatedData = data?.excalidraw_data || [];
      
      // If the data is an array (normal excalidraw data), add a special field for code
      if (Array.isArray(updatedData)) {
        // Create a special metadata object to store code
        const metaDataObject = {
          type: '_codeMetadata_',
          code: code,
          lastUpdated: new Date().toISOString()
        };
        
        // Check if there's already a metadata object
        const metaIndex = updatedData.findIndex(item => 
          typeof item === 'object' && item !== null && 'type' in item && item.type === '_codeMetadata_'
        );
        
        if (metaIndex >= 0) {
          // Update existing metadata
          updatedData[metaIndex] = metaDataObject;
        } else {
          // Add new metadata
          updatedData.push(metaDataObject);
        }
        
        // Save updated data - try without updated_at first
        try {
          const { error: updateError } = await supabase
            .from('designs')
            .update({ excalidraw_data: updatedData })
            .eq('id', designId);
            
          if (!updateError) {
            return { success: true };
          }
          
          // If that fails and it's about updated_at, try with updated_at
          if (updateError.message && !updateError.message.includes('updated_at')) {
            throw updateError; // Different error, just throw it
          }
          
          // Try with updated_at
          const { error: finalError } = await supabase
            .from('designs')
            .update({
              excalidraw_data: updatedData,
              updated_at: new Date().toISOString()
            })
            .eq('id', designId);
            
          if (finalError) throw finalError;
          
          return { success: true };
          
        } catch (updateError) {
          console.error('Error updating excalidraw_data:', updateError);
          return { success: false, error: updateError };
        }
      }
    }
    
    // If we get here, pass along the original error
    return { success: false, error };
    
  } catch (error) {
    console.error('Error in updateDesignCode:', error);
    return { success: false, error };
  }
}; 