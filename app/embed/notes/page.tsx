"use client";

import React from "react";
import NoteTakerPlugin from "@/components/plugins/note-taker-plugin";

export default function EmbedNotesPage() {
  return (
    <div className="w-screen h-screen bg-black text-white">
      <NoteTakerPlugin onClose={() => history.back()} />
    </div>
  );
}
