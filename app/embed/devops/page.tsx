"use client";
import DevOpsCommandCenterPlugin from "@/components/plugins/devops-command-center-plugin";
export default function Page() {
  return <div className="w-screen h-screen"><DevOpsCommandCenterPlugin onClose={() => history.back()} /></div>;
}
