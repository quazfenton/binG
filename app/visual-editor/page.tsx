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
      }
    }
  }, []);

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