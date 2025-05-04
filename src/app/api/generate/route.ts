import { NextRequest, NextResponse } from 'next/server';
import { sketchToCode } from '@/lib/ai';

export const runtime = 'edge';

export async function POST(req: NextRequest) {
  try {
    console.log('Generate API route called');
    
    // Extract JSON safely with error handling
    let requestData;
    try {
      requestData = await req.json();
    } catch (jsonError) {
      console.error('Error parsing request JSON:', jsonError);
      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }
    
    // Handle both old and new request formats
    const sketch_data = requestData.sketch_data || requestData.sketchData;
    const framework = requestData.framework || 'react';
    const css = requestData.css || 'tailwind';
    const userId = requestData.user_id || requestData.userId || '';
    const requestDesignId = requestData.designId;
    const useNonStreaming = requestData.useNonStreaming || false; // Add option for non-streaming
    
    console.log(`Request received - framework: ${framework}, css: ${css}, designId: ${requestDesignId || 'none'}`);
    console.log(`User ID: ${userId ? userId : '(not provided)'}`);
    console.log(`Sketch data has ${Array.isArray(sketch_data) ? sketch_data.length : 0} elements`);
    console.log(`Using ${useNonStreaming ? 'non-streaming' : 'streaming'} response`);
    
    if (!sketch_data) {
      console.error('Missing sketch data');
      // Generate a token even in case of error
      const errorDesignToken = generateErrorToken();
      return NextResponse.json(
        { 
          error: 'Missing sketch data', 
          designToken: errorDesignToken 
        },
        { status: 400 }
      );
    }

    if (!Array.isArray(sketch_data) || sketch_data.length === 0) {
      console.error('Invalid sketch data format or empty sketch');
      // Generate a token even in case of error
      const errorDesignToken = generateErrorToken();
      return NextResponse.json(
        { 
          error: 'Invalid sketch data format or empty sketch', 
          designToken: errorDesignToken 
        },
        { status: 400 }
      );
    }
    
    // Use request designId if available
    const aiCallOptions = {
      sketchData: sketch_data,
      framework: framework,
      css: css,
      userId: userId
    };
    
    // For non-streaming or if explicitly requested, use simple JSON response
    if (useNonStreaming || req.headers.get('accept') !== 'text/event-stream') {
      console.log('Using non-streaming response mode');
      
      try {
        // Generate a design token
        const designToken = requestDesignId || generateErrorToken();
        
        // Call AI function
        const result = await sketchToCode(aiCallOptions);
        
        // Return all data in a single JSON response
        return NextResponse.json({
          code: result.code || '',
          designToken: result.designToken || designToken,
          error: result.error || null,
          success: !result.error
        });
      } catch (error) {
        console.error('Non-streaming AI error:', error);
        return NextResponse.json({
          error: `Error generating code: ${error instanceof Error ? error.message : 'Unknown error'}`,
          designToken: generateErrorToken(),
          code: '',
          success: false
        }, { status: 500 });
      }
    }

    // Set up streaming response
    const encoder = new TextEncoder();
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();

    // Start the response stream
    const response = new NextResponse(stream.readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no', // Disable buffering in Nginx
        'Transfer-Encoding': 'chunked'
      },
    });

    // Write helper function
    const writeToStream = async (text: string) => {
      try {
        console.log(`Writing to stream: ${text.substring(0, 100)}${text.length > 100 ? '...' : ''}`);
        await writer.write(encoder.encode(`${text}\n`));
      } catch (writeError) {
        console.error('Error writing to stream:', writeError);
      }
    };

    // Call AI function to generate code directly from sketch data
    try {
      console.log('Calling sketchToCode function with sketch data and userId...');
      
      // Use request designId if available
      const aiCallOptions = {
        sketchData: sketch_data,
        framework: framework,
        css: css,
        userId: userId
      };
      
      console.log('AI function call options:', JSON.stringify({
        ...aiCallOptions,
        sketchData: `[${sketch_data.length} elements]`
      }));
      
      // First send start message
      await writeToStream(JSON.stringify({ message: 'start', info: 'Beginning code generation' }));
      
      // Then if we have a design ID, send it immediately
      if (requestDesignId) {
        await writeToStream(JSON.stringify({
          message: 'token',
          designToken: requestDesignId,
          info: 'Using existing design ID'
        }));
      }
      
      // Call the AI function
      console.log('Calling AI function...');
      const result = await sketchToCode(aiCallOptions);
      console.log('AI function returned result');

      console.log(`AI result received - Has error: ${!!result.error}, Code length: ${result.code?.length || 0}`);
      console.log(`Design token received: ${result.designToken}`);
      
      if (result.error) {
        // Send error message
        console.error(`AI error: ${result.error}`);
        if (result.debug) {
          console.error('Debug info:', result.debug);
        }
        
        // First send the design token if available
        if (result.designToken) {
          await writeToStream(JSON.stringify({
            message: 'token',
            designToken: result.designToken
          }));
        }
        
        await writeToStream(JSON.stringify({ 
          message: 'error', 
          error: result.error
        }));
      } else if (!result.code || result.code.trim() === '') {
        // Handle empty code case
        console.error('Empty code returned from AI');
        
        // First send the design token if available
        if (result.designToken) {
          await writeToStream(JSON.stringify({
            message: 'token',
            designToken: result.designToken
          }));
        }
        
        await writeToStream(JSON.stringify({ 
          message: 'error', 
          error: 'No code was generated. The sketch may not contain recognizable UI elements.'
        }));
      } else {
        // Stream the code in chunks for better user experience
        const code = result.code;
        console.log(`Streaming code response (${code.length} characters)...`);
        
        // Send design token first
        if (result.designToken) {
          await writeToStream(JSON.stringify({
            message: 'token',
            designToken: result.designToken
          }));
        }
        
        // For longer code, stream it in chunks
        if (code.length > 1000) {
          const chunks = Math.ceil(code.length / 1000);
          console.log(`Splitting code into ${chunks} chunks`);
          
          for (let i = 0; i < chunks; i++) {
            const start = i * 1000;
            const end = Math.min((i + 1) * 1000, code.length);
            const chunk = code.substring(start, end);
            
            console.log(`Sending chunk ${i+1}/${chunks}, size: ${chunk.length}`);
            await writeToStream(JSON.stringify({ 
              code: chunk,
              isLast: i === chunks - 1,
              chunkIndex: i,
              totalChunks: chunks
            }));
            
            // Small delay to avoid overwhelming the client
            await new Promise(resolve => setTimeout(resolve, 50));
          }
        } else {
          // For shorter code, send it in one go
          console.log('Sending code in a single chunk, size:', code.length);
          await writeToStream(JSON.stringify({ 
            code: code,
            isLast: true,
            chunkIndex: 0,
            totalChunks: 1
          }));
        }
        
        // Success message
        await writeToStream(JSON.stringify({ 
          message: 'success', 
          info: 'Code generated successfully',
          codeLength: code.length
        }));
      }
    } catch (aiError) {
      console.error('AI processing error:', aiError);
      
      // Generate a token even in case of error
      const errorDesignToken = generateErrorToken();
      
      // Send the token first
      await writeToStream(JSON.stringify({
        message: 'token',
        designToken: errorDesignToken 
      }));
      
      // Then send the error
      await writeToStream(JSON.stringify({ 
        message: 'error', 
        error: `Error generating code: ${aiError instanceof Error ? aiError.message : 'Unknown error'}`
      }));
    }

    // Done message
    await writeToStream(JSON.stringify({ message: 'end' }));
    
    try {
      await writer.close();
    } catch (closeError) {
      console.error('Error closing stream writer:', closeError);
    }

    return response;
    
  } catch (error) {
    console.error('Generate API error:', error);
    
    // Generate a token even for wrapper errors
    const errorToken = generateErrorToken();
    
    return NextResponse.json(
      { 
        error: 'Failed to generate code', 
        details: error instanceof Error ? error.message : 'Unknown error',
        designToken: errorToken
      },
      { status: 500 }
    );
  }
}

// Helper function to generate a UUID token in case of error
function generateErrorToken(): string {
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