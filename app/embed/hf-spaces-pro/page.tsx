"use client";
import HuggingFaceSpacesProPlugin from "@/components/plugins/huggingface-spaces-pro-plugin";
export default function Page() {
  return <div className="w-screen h-screen"><HuggingFaceSpacesProPlugin onClose={() => history.back()} /></div>;
}
