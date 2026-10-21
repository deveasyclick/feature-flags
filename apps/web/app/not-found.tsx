import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-6 py-24">
      <p className="text-muted-foreground font-mono text-sm">404</p>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">
        This page could not be found
      </h1>
      <p className="text-muted-foreground mt-3 max-w-md leading-7">
        The page you are looking for does not exist or may have been moved.
      </p>
      <div className="mt-8">
        <Button asChild>
          <Link href="/">Back to home</Link>
        </Button>
      </div>
    </main>
  );
}
