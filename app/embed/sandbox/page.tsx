"use client";
import CodeSandboxPlugin from "@/components/plugins/code-sandbox-plugin";
export default function Page() {
  return <div className="w-screen h-screen"><CodeSandboxPlugin onClose={() => history.back()} /></div>;
}
