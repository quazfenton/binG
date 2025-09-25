"use client";

import React from "react";
import GitHubExplorerPlugin from "@/components/plugins/github-explorer-plugin";

export default function EmbedGithubPage() {
  return (
    <div className="w-screen h-screen bg-black text-white">
      <GitHubExplorerPlugin onClose={() => history.back()} />
    </div>
  );
}
