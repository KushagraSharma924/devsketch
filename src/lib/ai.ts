import OpenAI from 'openai';
import { RateLimiter } from 'limiter';

// Types for sketch-to-code interface
export interface SketchToCodeInput {
  sketchData: any;
  framework: string;
  css: string;
  userId?: string; // Add userId for reference
}

export interface SketchToCodeOutput {
  code: string;
  error?: string;
  debug?: any;
  designToken?: string; // Add field to return design token
}

// Create OpenAI client using environment variables
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
});

// Rate limiter: 3 requests per minute
const limiter = new RateLimiter({
  tokensPerInterval: 3,
  interval: 'minute',
});

// Generate a unique token for the design
const generateDesignToken = (): string => {
  // Generate a proper UUID v4 format that matches what the application expects
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
};

// Helper function to clean up code output from AI
const cleanCodeOutput = (rawOutput: string): string => {
  // Remove any markdown code block markers
  let code = rawOutput.replace(/```(jsx?|tsx?|javascript|react)?/g, '').replace(/```/g, '');
  
  // Remove any leading/trailing explanations
  if (code.includes('import ')) {
    const firstImportIndex = code.indexOf('import ');
    if (firstImportIndex > 0) {
      code = code.substring(firstImportIndex);
    }
  }
  
  // Remove any explanation text after the last export
  if (code.includes('export ')) {
    const lastExportIndex = code.lastIndexOf('export ');
    if (lastExportIndex >= 0) {
      const lines = code.substring(lastExportIndex).split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('export ') && lines[i].includes(';')) {
          code = code.substring(0, lastExportIndex + lines.slice(0, i + 1).join('\n').length);
          break;
        }
      }
    }
  }
  
  // Remove any remaining explanations or text outside of code
  code = code.trim();
  
  return code;
};

/*
 * Convert Excalidraw sketch to code using OpenAI API only
 */
export async function sketchToCode({
  sketchData,
  framework,
  css,
  userId,
}: SketchToCodeInput): Promise<SketchToCodeOutput> {
  // Debug info
  console.log(`Generating code with framework: ${framework}, css: ${css}`);
  console.log(`User ID: ${userId ? userId : '(not provided)'}`);
  console.log(`Sketch data has ${Array.isArray(sketchData) ? sketchData.length : 0} elements`);

  // Generate a design token
  const designToken = generateDesignToken();
  console.log(`Generated design token: ${designToken}`);

  // Validate sketch data
  if (!sketchData || !Array.isArray(sketchData) || sketchData.length === 0) {
    console.error('Invalid or empty sketch data');
    
    return {
      code: '',
      error: 'Error: Empty sketch data. Please add elements to your drawing before generating code.',
      debug: { sketchData: typeof sketchData, length: Array.isArray(sketchData) ? sketchData.length : 0 },
      designToken
    };
  }

  // Check rate limit
  const hasTokens = await limiter.removeTokens(1);
  if (!hasTokens) {
    console.warn('Rate limit exceeded');
    
    return {
      code: '',
      error: 'Rate limit exceeded. Please try again in a minute.',
      designToken
    };
  }

  // Create a simpler, more compact JSON representation of the sketch
  // This prevents errors with circular references and reduces size
  const simplifiedSketch = sketchData.map((element: any) => {
    // Extract only essential properties for better AI interpretation
    // and to reduce payload size
    const { 
      id, 
      type, 
      x, 
      y, 
      width, 
      height, 
      text, 
      fontSize, 
      strokeColor, 
      backgroundColor, 
      fillStyle,
      groupIds
    } = element;
    
    // Return a minimal representation
    return { 
      id, 
      type, 
      x, 
      y, 
      width, 
      height, 
      text, 
      fontSize, 
      strokeColor, 
      backgroundColor, 
      fillStyle,
      groupIds: groupIds || []
    };
  });

  // Add user reference if available
  const userContext = userId && userId.trim() ? `\nReference ID: ${userId.substring(0, 8)}` : '';
  
  // Format a smaller, more focused prompt
  const promptTemplate = `Convert this Excalidraw sketch to ${framework} + ${css} code:
- Return ONLY pure code with no explanations or comments
- Use functional components
- Make the layout responsive
- Do NOT include commas between JSX attributes
- Do NOT include any explanation text before or after the code
- Give me ONLY the component code that I can directly copy and use
- Start with import statements and end with export statement${userContext}

Sketch JSON: ${JSON.stringify(simplifiedSketch)}`;

  console.log('Prompt created, sending to AI model...');
  
  // Try gpt-3.5-turbo first as it's faster
  try {
    console.log('Sending request to GPT-3.5 Turbo first for faster response...');
    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: `You are a specialized AI that converts Excalidraw sketches directly to clean code. 
Your task is to analyze the JSON representation of visual elements and translate them into functional code.

IMPORTANT OUTPUT RULES:
- Return ONLY pure code with no markdown formatting, no comments, and no explanations
- Do not wrap code in backticks or code blocks
- Do not include any comments like "here's the code" or "this will create..."
- Begin with import statements and end with export statement
- Do not include any text before or after the code

For Excalidraw elements:
- Rectangle elements should be converted to div containers with appropriate borders, width, height, and positioning
- Text elements should become headings, paragraphs, labels, or button text depending on context
- Lines should be interpreted as dividers or connectors between components
- Circles/ellipses often represent buttons, avatars, or decorative elements`,
        },
        {
          role: 'user',
          content: promptTemplate,
        },
      ],
      temperature: 0.2,
      max_tokens: 4000, // Reduced token count
    }, {
      timeout: 15000 // 15 second timeout for faster failure
    });

    // Log response info for debugging
    console.log(`GPT-3.5 Turbo response received, content length: ${response.choices[0]?.message?.content?.length || 0}`);
    
    let generatedCode = response.choices[0]?.message?.content || '';
    
    if (!generatedCode || generatedCode.trim() === '') {
      console.error('GPT-3.5-turbo returned empty content, will try fallback');
      throw new Error('Empty response from GPT-3.5-turbo');
    }

    // Clean up the code output
    generatedCode = cleanCodeOutput(generatedCode);

    return {
      code: generatedCode,
      designToken
    };
  } catch (error) {
    console.error('Error with GPT-3.5 Turbo, trying GPT-4o-mini:', error);

    try {
      // Try GPT-4o-mini with a shorter timeout
      console.log('Trying GPT-4o-mini with reduced complexity...');
      
      // Create an even simpler representation for GPT-4o-mini
      const verySimplifiedSketch = simplifiedSketch.map((element: any) => {
        const { id, type, x, y, width, height, text } = element;
        return { id, type, x, y, width, height, text };
      });
      
      // Simpler prompt for GPT-4o-mini
      const miniPromptTemplate = `Convert this sketch to ${framework} with ${css}:
- Return ONLY code with no explanations
- Do NOT use commas between JSX attributes
- Only include import statements, component code, and export statement
- No markdown formatting, no comments, just pure code
Sketch: ${JSON.stringify(verySimplifiedSketch)}`;
      
      const fallbackResponse = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You convert sketches directly to pure code. Return ONLY the code itself - no explanations, no markdown formatting, no code block markers, and no additional text. Start with imports and end with export statement.',
          },
          {
            role: 'user',
            content: miniPromptTemplate,
          },
        ],
        temperature: 0.2,
        max_tokens: 2000, // Even smaller token count
      }, {
        timeout: 15000 // 15 second timeout
      });
      
      console.log(`GPT-4o-mini response received, content length: ${fallbackResponse.choices[0]?.message?.content?.length || 0}`);
      
      const fallbackCode = fallbackResponse.choices[0]?.message?.content || '';
      
      if (!fallbackCode || fallbackCode.trim() === '') {
        return {
          code: '', 
          error: 'Failed to generate code. Please try again with a simpler sketch.',
          designToken
        };
      }
      
      // Clean up the fallback code output
      const cleanedFallbackCode = cleanCodeOutput(fallbackCode);
      
      return {
        code: cleanedFallbackCode,
        designToken
      };
    } catch (fallbackError) {
      console.error('All model attempts failed:', fallbackError);
      
      // Return a basic template as last resort
      const basicTemplate = `// Basic ${framework} component with ${css}
${framework === 'react' ? `
import React from 'react';

export default function GeneratedComponent() {
  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Generated Component</h1>
      <p>The sketch could not be properly converted to code.</p>
      <p>Please try again with a simpler sketch.</p>
    </div>
  );
}` : `// Fallback code for ${framework}`}`;
      
      return {
        code: basicTemplate,
        error: 'Failed to generate code after multiple attempts. Returning a basic template.',
        designToken
      };
    }
  }
} 