import type { Metadata } from "next";
import { Geist, JetBrains_Mono } from "next/font/google";
import "./globals.css";

/** Secondary face: used for long-form prose and supporting copy. */
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

/** Primary face: the default typeface across the application. */
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Iwifunni",
    template: "%s · Iwifunni",
  },
  description:
    "Feature management and progressive delivery for modern applications. Control features without deploying, target users, and roll out gradually.",
  applicationName: "Iwifunni",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${jetbrainsMono.variable} ${geistSans.variable} h-full antialiased`}
    >
      <body className="bg-background text-foreground flex min-h-full flex-col">
        {children}
      </body>
    </html>
  );
}
