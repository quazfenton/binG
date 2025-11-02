"use client";
import WikiKnowledgeBasePlugin from "@/components/plugins/wiki-knowledge-base-plugin";
export default function Page() {
  return <div className="w-screen h-screen"><WikiKnowledgeBasePlugin onClose={() => history.back()} /></div>;
}
