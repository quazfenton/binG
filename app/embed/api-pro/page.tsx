"use client";
import APIPlaygroundProPlugin from "@/components/plugins/api-playground-pro-plugin";
export default function Page() {
  return <div className="w-screen h-screen"><APIPlaygroundProPlugin onClose={() => history.back()} /></div>;
}
