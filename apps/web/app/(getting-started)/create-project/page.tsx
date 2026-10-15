import type { Metadata } from "next";
import { CreateProjectForm } from "@/components/auth/create-project-form";

export const metadata: Metadata = {
  title: "Create project",
  description:
    "Set up your first Iwifunni project and the environment your flags live in.",
};

export default function CreateProjectPage() {
  return <CreateProjectForm />;
}
