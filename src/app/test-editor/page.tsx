'use client';

import { useState } from 'react';
import Editor from '@monaco-editor/react';

export default function TestEditorPage() {
  const [code, setCode] = useState<string>("// Write your code here\nconsole.log('Hello World!');\n");

  return (
    <div className="min-h-screen bg-gray-100 p-4">
      <h1 className="text-2xl font-bold mb-4">Test Monaco Editor</h1>
      
      <div className="bg-white p-4 rounded-md shadow-md">
        <p className="mb-2">The editor should appear below:</p>
        
        <div className="h-[500px] border border-gray-300 bg-white">
          <Editor
            height="100%"
            width="100%"
            defaultLanguage="typescript"
            defaultValue={code}
            onChange={(value) => value && setCode(value)}
            options={{
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
            }}
          />
        </div>
        
        <div className="mt-4">
          <p className="font-medium">Current code value:</p>
          <pre className="bg-gray-100 p-2 rounded mt-2 overflow-auto">
            {code}
          </pre>
        </div>
      </div>
    </div>
  );
} 