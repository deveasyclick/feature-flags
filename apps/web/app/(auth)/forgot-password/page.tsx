import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export const metadata: Metadata = {
  title: "Reset password",
  description: "Request a password reset code for your Iwifunni account.",
};

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
