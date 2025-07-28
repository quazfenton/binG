"use client"

import VisualEditor from "@/components/visual_editor_components";
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

export default function VisualEditorPage() {
  const [project, setProject] = useState(null);

  useEffect(() => {
    // Load project data from localStorage
    const savedProject = localStorage.getItem('visualEditorProject');
    if (savedProject) {
      try {
        setProject(JSON.parse(savedProject));
      } catch (e) {
        console.error('Failed to parse project data', e);
        // Create a default project if parsing fails
        createDefaultProject();
      }
    } else {
      // Create a default project if none exists
      createDefaultProject();
    }
  }, []);

  const createDefaultProject = () => {
    const defaultProject = {
      framework: 'react',
      files: {
        'App.jsx': `import React from 'react';

function App() {
  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      <h1>Welcome to Visual Editor</h1>
      <p>Start editing your project!</p>
    </div>
  );
}

export default App;`,
        'index.js': `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);`
      }
    };
    setProject(defaultProject);
  };

  return (
    <div className="h-screen w-screen bg-gray-900">
      {project ? (
        <VisualEditor initialProject={project} />
      ) : (
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <RefreshCw className="w-12 h-12 animate-spin mx-auto mb-4 text-blue-400" />
            <p className="text-gray-400">Loading visual editor...</p>
          </div>
        </div>
      )}
    </div>
  );
}