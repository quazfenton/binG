"use client";

import React from "react";
import HuggingFaceSpacesPlugin from "@/components/plugins/huggingface-spaces-plugin";

export default function EmbedHFSpacesPage() {
  return (
    <div className="w-screen h-screen bg-black text-white">
      <HuggingFaceSpacesPlugin onClose={() => history.back()} />
    </div>
  );
}
