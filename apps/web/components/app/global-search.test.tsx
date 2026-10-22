import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { GlobalSearch } from "./global-search";
import { apiKeys, flags, segments } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  flags: { list: vi.fn() }, segments: { list: vi.fn() }, apiKeys: { list: vi.fn() },
}));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it("searches only the selected project and lets keyboard users reach results", async () => {
  vi.mocked(flags.list).mockResolvedValue({ data: [], nextCursor: null });
  vi.mocked(segments.list).mockResolvedValue({ data: [], nextCursor: null });
  vi.mocked(apiKeys.list).mockResolvedValue({ data: [], nextCursor: null });
  render(<GlobalSearch projectKey="checkout" environmentKey="production" />);
  const input = screen.getByRole("searchbox");
  fireEvent.keyDown(document, { key: "k", ctrlKey: true });
  expect(document.activeElement).toBe(input);
  fireEvent.change(input, { target: { value: "missing" } });
  await screen.findByText("No matches.");
  expect(flags.list).toHaveBeenCalledWith("checkout", expect.objectContaining({ search: "missing", environmentKey: "production" }), expect.objectContaining({ signal: expect.any(AbortSignal) }));
  expect(apiKeys.list).toHaveBeenCalledWith("checkout", expect.objectContaining({ search: "missing" }), expect.anything());
  fireEvent.keyDown(input, { key: "Escape" });
  expect(screen.queryByRole("region", { name: "Search results" })).toBeNull();
});

it("shows a retryable failure rather than pretending a failed search found nothing", async () => {
  vi.mocked(flags.list).mockRejectedValue(new Error("Search unavailable"));
  vi.mocked(segments.list).mockResolvedValue({ data: [], nextCursor: null });
  vi.mocked(apiKeys.list).mockResolvedValue({ data: [], nextCursor: null });
  render(<GlobalSearch projectKey="checkout" />);
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "flag" } });
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Search unavailable"));
});
