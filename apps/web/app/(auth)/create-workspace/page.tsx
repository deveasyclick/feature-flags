import type { Metadata } from "next";

import { CreateWorkspaceForm } from "@/components/auth/create-workspace-form";

export const metadata: Metadata = {
  title: "Create workspace",
  description: "Create a workspace to hold your Iwifunni projects and flags.",
};

export default function CreateWorkspacePage() {
  return <CreateWorkspaceForm />;
}
