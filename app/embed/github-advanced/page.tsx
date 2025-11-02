"use client";
import GitHubExplorerAdvancedPlugin from "@/components/plugins/github-explorer-advanced-plugin";
export default function Page() {
  return <div className="w-screen h-screen"><GitHubExplorerAdvancedPlugin onClose={() => history.back()} /></div>;
}
