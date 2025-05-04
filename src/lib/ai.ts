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
    
    // Return empty code instead of a default component
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
    
    // Return empty code instead of a rate limit message component
    return {
      code: '',
      error: 'Rate limit exceeded. Please try again in a minute.',
      designToken
    };
  }

  // Create a simpler JSON representation of the sketch
  // This prevents errors with circular references and reduces size
  const simplifiedSketch = sketchData.map((element: any) => {
    // Extract more properties for better AI interpretation
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
      roughness,
      opacity,
      strokeWidth,
      roundness,
      isDeleted,
      angle,
      groupIds,
      boundElements,
      link
    } = element;
    
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
      roughness: roughness || 0,
      opacity: opacity || 100,
      strokeWidth: strokeWidth || 1,
      roundness: roundness || null,
      isDeleted: isDeleted || false,
      angle: angle || 0,
      groupIds: groupIds || [],
      boundElements: boundElements || [],
      link: link || null
    };
  });

  // Add user reference if available
  const userContext = userId && userId.trim() ? `\nReference ID: ${userId.substring(0, 8)}` : '';
  
  // Format the prompt with the provided data
  const promptTemplate = `Convert this Excalidraw sketch to ${framework} + ${css} code:
- Use functional components
- Make responsive
- Export all dependencies
- Return ONLY code
- DO NOT use offline templates, generate all code from scratch
- Interpret all visual elements (rectangles, circles, lines, text) and convert them to appropriate UI components
- Rectangle shapes should become div containers with borders
- Text elements should be rendered as appropriate heading or paragraph elements
- Consider relative positioning of elements when designing the layout${userContext}

IMPORTANT: ALWAYS return working code that renders something, even if the sketch is unclear. If unsure about the intent, create a reasonable default component.

Sketch JSON: ${JSON.stringify(simplifiedSketch)}`;

  console.log('Prompt created, sending to AI model...');

  try {
    // Use GPT-4o Mini
    console.log('Sending request to GPT-4o-mini...');
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a specialized AI that converts Excalidraw sketches to code. 
Your primary task is to analyze the JSON representation of visual elements and translate them into functional code.

For Excalidraw elements:
- Rectangle elements should be converted to div containers with appropriate borders, width, height, and positioning
- Text elements should become headings, paragraphs, labels, or button text depending on context
- Lines should be interpreted as dividers or connectors between components
- Circles/ellipses often represent buttons, avatars, or decorative elements

Consider:
- The relative positioning (x, y coordinates) to determine layout structure
- Size (width, height) for responsive dimensions
- Colors (strokeColor, backgroundColor) for styling
- Text content and fontSize for typography
- Element grouping (groupIds) to identify related components

Always generate code from scratch, do not use templates.`,
        },
        {
          role: 'user',
          content: promptTemplate,
        },
      ],
      temperature: 0.2,
      max_tokens: 8000,
    }, {
      timeout: 45000
    });

    // Log response info for debugging
    console.log(`OpenAI response received, content length: ${response.choices[0]?.message?.content?.length || 0}`);
    
    const generatedCode = response.choices[0]?.message?.content || '';
    
    if (!generatedCode || generatedCode.trim() === '') {
      console.error('GPT-4o-mini returned empty content');
      throw new Error('Empty response from GPT-4o-mini');
    }

    return {
      code: generatedCode,
      designToken
    };
  } catch (error) {
    console.error('Error with GPT-4o Mini, falling back to GPT-3.5 Turbo:', error);

    try {
      // Fallback to GPT-3.5 Turbo
      console.log('Falling back to GPT-3.5 Turbo...');
      const fallbackResponse = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: `You are a specialized AI that converts Excalidraw sketches to code. 
Your primary task is to analyze the JSON representation of visual elements and translate them into functional code.

For Excalidraw elements:
- Rectangle elements should be converted to div containers with appropriate borders, width, height, and positioning
- Text elements should become headings, paragraphs, labels, or button text depending on context
- Lines should be interpreted as dividers or connectors between components
- Circles/ellipses often represent buttons, avatars, or decorative elements

Consider:
- The relative positioning (x, y coordinates) to determine layout structure
- Size (width, height) for responsive dimensions
- Colors (strokeColor, backgroundColor) for styling
- Text content and fontSize for typography
- Element grouping (groupIds) to identify related components

Always generate code from scratch, do not use templates.`,
          },
          {
            role: 'user',
            content: promptTemplate,
          },
        ],
        temperature: 0.2,
        max_tokens: 8000,
      }, {
        timeout: 45000
      });
      
      // Log fallback response info for debugging
      console.log(`Fallback response received, content length: ${fallbackResponse.choices[0]?.message?.content?.length || 0}`);
      
      const generatedCode = fallbackResponse.choices[0]?.message?.content || '';
      
      if (!generatedCode || generatedCode.trim() === '') {
        console.error('GPT-3.5-turbo returned empty content');
        return {
          code: '',
          error: 'AI models failed to generate code from the sketch. The sketch may be too complex or not contain recognizable UI elements.',
          debug: { 
            error: 'Empty response from fallback model',
            sketchLength: sketchData.length 
          },
          designToken
        };
      }
      
      return {
        code: generatedCode,
        designToken
      };
    } catch (fallbackError) {
      console.error('Error with fallback model:', fallbackError);
      
      // Return empty code instead of emergency fallback component
      return {
        code: '',
        error: 'Failed to generate code using both primary and fallback models.',
        debug: { 
          primaryError: error instanceof Error ? error.message : 'Unknown error', 
          fallbackError: fallbackError instanceof Error ? fallbackError.message : 'Unknown error',
          sketchLength: sketchData.length 
        },
        designToken
      };
    }
  }
} 