import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  FlagDetail,
  FlagEnvironmentConfig,
  TargetingRule,
} from "@dariise/contracts";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {},
  flags: { publishTargeting: vi.fn() },
  changeRequests: { create: vi.fn() },
}));

const { FlagTargeting } = await import(
  "@/components/app/flags/flag-targeting"
);

afterEach(cleanup);

const variations = [
  { key: "off", name: "Off", value: false, description: null },
  { key: "on", name: "On", value: true, description: null },
];

const flag: FlagDetail = {
  id: "flag-1",
  projectId: "project-1",
  key: "checkout-v2",
  name: "Checkout v2",
  description: null,
  type: "boolean",
  tags: [],
  owner: null,
  status: "active",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  environments: [
    {
      environmentKey: "development",
      environmentName: "Development",
      enabled: true,
      rolloutPercentage: 100,
    },
  ],
  variations,
};

const config: FlagEnvironmentConfig = {
  environmentKey: "development",
  environmentName: "Development",
  enabled: true,
  offVariation: "off",
  defaultVariation: "off",
  rolloutPercentage: 100,
  bucketBy: "userId",
  rules: [],
  individualTargets: [],
};

function rule(overrides: Partial<TargetingRule> = {}): TargetingRule {
  return {
    id: "rule-1",
    description: null,
    conditions: [],
    variation: "on",
    segmentKeys: [],
    rollout: null,
    ...overrides,
  };
}

function renderTargeting(rules: TargetingRule[]) {
  return render(
    <FlagTargeting
      projectKey="project-1"
      flagKey="checkout-v2"
      flag={flag}
      config={config}
      rules={rules}
      targets={[]}
      segments={[]}
      updatedLabel="4 days ago"
      approval={null}
      protectedEnvironment={false}
    />,
  );
}

const completeCondition = {
  id: "condition-1",
  attribute: "country",
  attributeType: "string" as const,
  operator: "equals" as const,
  values: ["US"],
};

describe("the rule list", () => {
  it("shows every rule collapsed, with its number, count and summary", () => {
    renderTargeting([
      rule({ id: "rule-1", conditions: [completeCondition] }),
      rule({ id: "rule-2", description: "Beta testers" }),
    ]);

    expect(screen.getByRole("button", { name: "Rule 1" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Rule 2" })).toBeDefined();

    const first = screen.getByRole("button", { name: "Rule 1" });
    const second = screen.getByRole("button", { name: "Rule 2" });

    expect(first.textContent).toContain("1 condition");
    expect(first.textContent).toContain("country is US");
    expect(second.textContent).toContain("Beta testers");
  });

  it("summarises a rule with no conditions as matching everybody", () => {
    renderTargeting([rule()]);

    expect(screen.getByText("Matches everybody")).toBeDefined();
  });

  it("marks a rule whose condition is unfinished", () => {
    renderTargeting([
      rule({
        conditions: [
          {
            id: "condition-1",
            attribute: "",
            attributeType: "string",
            operator: "equals",
            values: [],
          },
        ],
      }),
    ]);

    expect(screen.getByText("1 need attention")).toBeDefined();
  });

  it("shows which rule is valid", () => {
    renderTargeting([rule({ conditions: [completeCondition] })]);

    expect(screen.getByText("Valid")).toBeDefined();
  });
});

describe("expanding a rule", () => {
  it("keeps its editor hidden until the rule is opened", () => {
    renderTargeting([rule({ conditions: [completeCondition] })]);

    expect(screen.queryByLabelText("Description for rule 1")).toBeNull();
  });

  it("opens the rule that was clicked", async () => {
    const user = userEvent.setup();

    renderTargeting([rule()]);
    await user.click(screen.getByRole("button", { name: "Rule 1" }));

    expect(screen.getByLabelText("Description for rule 1")).toBeDefined();
    expect(screen.getByText("All conditions must match")).toBeDefined();
  });

  it("closes the rule that was open, so one editor shows at a time", async () => {
    const user = userEvent.setup();

    renderTargeting([rule({ id: "rule-1" }), rule({ id: "rule-2" })]);
    await user.click(screen.getByRole("button", { name: "Rule 1" }));
    await user.click(screen.getByRole("button", { name: "Rule 2" }));

    expect(screen.queryByLabelText("Description for rule 1")).toBeNull();
    expect(screen.getByLabelText("Description for rule 2")).toBeDefined();
  });

  it("closes a rule when its own header is clicked again", async () => {
    const user = userEvent.setup();

    renderTargeting([rule()]);
    const header = screen.getByRole("button", { name: "Rule 1" });

    await user.click(header);
    await user.click(header);

    expect(screen.queryByLabelText("Description for rule 1")).toBeNull();
  });
});

describe("the rule actions", () => {
  it("adds a rule and opens it", async () => {
    const user = userEvent.setup();

    renderTargeting([]);
    await user.click(screen.getByRole("button", { name: /Add targeting rule/ }));

    expect(screen.getByText("Rule 1")).toBeDefined();
    expect(screen.getByLabelText("Description for rule 1")).toBeDefined();
  });

  it("duplicates a rule directly after the original and opens the copy", async () => {
    const user = userEvent.setup();

    renderTargeting([
      rule({ id: "rule-1", conditions: [completeCondition] }),
      rule({ id: "rule-2", description: "Second" }),
    ]);

    await user.click(screen.getByRole("button", { name: "Actions for rule 1" }));
    await user.click(await screen.findByRole("menuitem", { name: /Duplicate rule/ }));

    // Three rules now, and the copy is the one holding the editor.
    expect(screen.getByRole("button", { name: "Rule 3" })).toBeDefined();
    expect(await screen.findByLabelText("Description for rule 2")).toBeDefined();
    expect(screen.queryByLabelText("Description for rule 3")).toBeNull();
  });

  it("moves a rule down and renumbers the list", async () => {
    const user = userEvent.setup();

    renderTargeting([
      rule({ id: "rule-1", description: "First" }),
      rule({ id: "rule-2", description: "Second" }),
    ]);

    await user.click(screen.getByRole("button", { name: "Actions for rule 1" }));
    await user.click(await screen.findByRole("menuitem", { name: /Move down/ }));

    const order = screen
      .getAllByRole("button", { name: /^Rule \d$/ })
      .map((header) => header.textContent);

    // Each header carries its own number, so the reordered list reads Second first.
    expect(order[0]).toContain("Second");
    expect(order[1]).toContain("First");
  });

  it("refuses to move the first rule up", async () => {
    const user = userEvent.setup();

    renderTargeting([rule({ id: "rule-1" }), rule({ id: "rule-2" })]);

    await user.click(screen.getByRole("button", { name: "Actions for rule 1" }));

    const moveUp = await screen.findByRole("menuitem", { name: /Move up/ });

    expect(moveUp.getAttribute("data-disabled")).not.toBeNull();
  });

  it("deletes a rule and offers to put it back", async () => {
    const user = userEvent.setup();

    renderTargeting([
      rule({ id: "rule-1", description: "Keep me" }),
      rule({ id: "rule-2", description: "Remove me" }),
    ]);

    await user.click(screen.getByRole("button", { name: "Actions for rule 2" }));
    await user.click(await screen.findByRole("menuitem", { name: /Delete rule/ }));

    expect(screen.queryByRole("button", { name: "Rule 2" })).toBeNull();
    expect(screen.getByText(/Deleted rule 2/)).toBeDefined();

    await user.click(screen.getByRole("button", { name: /Undo/ }));

    expect(screen.getByRole("button", { name: "Rule 2" }).textContent).toContain(
      "Remove me",
    );
  });
});

describe("publishing", () => {
  // Publishing lives in the sidebar beside the fallback rule and is always on
  // screen; what changes is whether there is anything for it to send.
  it("will not publish while the draft is clean", () => {
    renderTargeting([rule({ conditions: [completeCondition] })]);

    const publish = screen.getByRole("button", { name: /Save & Publish/ });

    expect(publish).toBeDefined();
    expect(publish.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("No unpublished changes.")).toBeDefined();
  });

  it("offers to publish once the draft changes", async () => {
    const user = userEvent.setup();

    renderTargeting([rule()]);
    await user.click(screen.getByRole("button", { name: /Add targeting rule/ }));

    const publish = screen.getByRole("button", { name: /Save & Publish/ });

    expect(publish.hasAttribute("disabled")).toBe(false);
    expect(screen.queryByText("No unpublished changes.")).toBeNull();
  });

  it("keeps the default rule available as the fallback", () => {
    renderTargeting([rule()]);

    // The fallback is not a rule in the priority order, so it is asserted by its
    // own control rather than by a rule card.
    expect(screen.getByLabelText("Serve variation")).toBeDefined();
  });
});
