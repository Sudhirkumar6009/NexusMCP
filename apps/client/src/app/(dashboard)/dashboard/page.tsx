"use client";

import React from "react";
import { AgenticFlowRunner } from "@/components/dashboard/agentic-flow-runner";
import { ManagementZone } from "@/components/dashboard/management-zone";
import { StepRunsConsole } from "@/components/dashboard/step-runs-console";

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <AgenticFlowRunner />
      <ManagementZone />
      <StepRunsConsole />
    </div>
  );
}
