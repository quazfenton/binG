"use client";
import DataScienceWorkbenchPlugin from "@/components/plugins/data-science-workbench-plugin";
export default function Page() {
  return <div className="w-screen h-screen"><DataScienceWorkbenchPlugin onClose={() => history.back()} /></div>;
}
