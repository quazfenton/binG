"use client";
import AIPromptLibraryPlugin from "@/components/plugins/ai-prompt-library-plugin";
export default function Page() {
  return <div className="w-screen h-screen"><AIPromptLibraryPlugin onClose={() => history.back()} /></div>;
}
