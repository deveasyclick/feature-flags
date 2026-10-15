import type { SVGProps } from "react";

/**
 * Iwifunni brand mark: a flag pivoting on a mast, representing a feature being
 * toggled and progressively released. Inherits `currentColor`.
 */
export function Logo({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}
      {...props}
    >
      <path
        d="M6 21V4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M6 5.5h9.2a1 1 0 0 1 .82 1.57l-1.9 2.68a1 1 0 0 0 0 1.17l1.9 2.68a1 1 0 0 1-.82 1.57H6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
