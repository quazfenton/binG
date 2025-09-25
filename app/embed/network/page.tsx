"use client";

import React from "react";
import NetworkRequestBuilderPlugin from "@/components/plugins/network-request-builder-plugin";

export default function EmbedNetworkPage() {
  return (
    <div className="w-screen h-screen bg-black text-white">
      <NetworkRequestBuilderPlugin onClose={() => history.back()} />
    </div>
  );
}
