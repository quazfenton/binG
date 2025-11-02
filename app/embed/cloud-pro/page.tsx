"use client";
import CloudStorageProPlugin from "@/components/plugins/cloud-storage-pro-plugin";
export default function Page() {
  return <div className="w-screen h-screen"><CloudStorageProPlugin onClose={() => history.back()} /></div>;
}
