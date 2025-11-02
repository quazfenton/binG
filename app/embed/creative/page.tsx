"use client";
import CreativeStudioPlugin from "@/components/plugins/creative-studio-plugin";
export default function Page() {
  return <div className="w-screen h-screen"><CreativeStudioPlugin onClose={() => history.back()} /></div>;
}
