import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConditionList } from "@/components/app/targeting/condition-list";
import { newConditionDraft, type ConditionDraft } from "@/lib/targeting";

afterEach(cleanup);

function noop() {}

/**
 * The editor, as the reader meets it.
 *
 * The list is driven by the drafts it is handed, so a test renders one state at
 * a time and asserts which controls exist in it. The question these answer is
 * the one a unit test over the helpers cannot: whether a control is *reachable*.
 * The type selector was not, for a custom attribute, because nothing but that
 * selector can set a type - so gating it on a type already being set hid it for
 * good.
 */
function renderOne(
  condition: ConditionDraft,
  onChange: (id: string, patch: Partial<ConditionDraft>) => void = noop,
) {
  render(
    <ConditionList
      conditions={[condition]}
      emptyLabel="No conditions."
      onChange={onChange}
      onAdd={noop}
      onRemove={noop}
    />,
  );
}

const typed = (patch: Partial<ConditionDraft> = {}) => ({
  ...newConditionDraft(),
  ...patch,
});

describe("the attribute field", () => {
  it("offers the suggested keys with the type each one is guessed to be", () => {
    renderOne(typed());

    fireEvent.focus(screen.getByLabelText("Attribute for condition 1"));

    const options = screen.getAllByRole("option");

    expect(options.length).toBeGreaterThan(0);
    expect(screen.getByRole("option", { name: /beta/ })).toBeDefined();
    expect(screen.getByRole("option", { name: /beta/ }).textContent).toContain(
      "boolean",
    );
  });

  it("uses a suggested key when one is chosen", () => {
    const onChange = vi.fn();

    renderOne(typed(), onChange);
    fireEvent.focus(screen.getByLabelText("Attribute for condition 1"));
    fireEvent.click(screen.getByRole("option", { name: /beta/ }));

    expect(onChange).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ attribute: "beta" }),
    );
  });

  it("says a key the list does not name is used literally", () => {
    // The whole point of staying editable: a custom key is legitimate.
    renderOne(typed({ attribute: "user.beta" }));
    fireEvent.focus(screen.getByLabelText("Attribute for condition 1"));

    expect(screen.getByText(/is not a suggestion/)).toBeDefined();
  });
});

describe("the type control", () => {
  it("shows a suggested attribute the list's own type, marked as a guess", () => {
    renderOne(typed({ attribute: "beta" }));

    expect(screen.getByText("boolean?")).toBeDefined();
    expect(screen.queryByLabelText("Type for condition 1")).toBeNull();
  });

  it("gives a custom attribute an editable type", () => {
    // The regression: this control is the only way to set a type, so it has to
    // be rendered for every key the suggestion list gives no type to.
    renderOne(typed({ attribute: "accountTier" }));

    expect(screen.getByLabelText("Type for condition 1")).toBeDefined();
    expect(screen.queryByText("string?")).toBeNull();
  });

  it("gives a suggested attribute an editable type once it is overridden", () => {
    renderOne(typed({ attribute: "beta", attributeType: "string" }));

    expect(screen.getByLabelText("Type for condition 1")).toBeDefined();
    expect(screen.queryByText("boolean?")).toBeNull();
  });

  it("sets the type the reader picks", () => {
    // jsdom cannot drive a Radix select, so the control is found by its state:
    // a custom key opens with no type chosen, which is what makes it usable.
    renderOne(typed({ attribute: "accountTier" }));

    expect(screen.getByText("type?")).toBeDefined();
  });
});

describe("the controls that depend on an attribute", () => {
  it("hides the operator and the value until one is chosen", () => {
    renderOne(typed());

    expect(screen.queryByLabelText("Operator for condition 1")).toBeNull();
    expect(screen.queryByLabelText("Values for condition 1")).toBeNull();
    expect(
      screen.getByText(/appear once an attribute is chosen/),
    ).toBeDefined();
  });

  it("offers a boolean the two comparisons it can make", () => {
    renderOne(typed({ attribute: "beta", values: "true" }));

    expect(screen.getByLabelText("Operator for condition 1")).toBeDefined();
    expect(screen.getByLabelText("Value for condition 1")).toBeDefined();
  });

  it("withholds the numeric comparisons from a version", () => {
    // `appVersion` is text to the engine, and a numeric comparison on it returns
    // false for every value, so the operator must not be on offer.
    renderOne(typed({ attribute: "appVersion", values: "1.4.0" }));

    expect(screen.getByLabelText("Operator for condition 1")).toBeDefined();
    expect(screen.getByLabelText("Operator for condition 1").textContent).not.toContain(
      "greater than",
    );
  });

  it("reports an attribute that is still missing", () => {
    renderOne(typed());

    expect(
      screen.getByText("Choose an attribute for this condition."),
    ).toBeDefined();
  });

  it("ties the message to the field it is about", () => {
    // The message has to be reachable from the control, or a reader who cannot
    // see the row is told the condition is wrong with no way to find it.
    renderOne(typed());

    const field = screen.getByLabelText("Attribute for condition 1");
    const describedBy = field.getAttribute("aria-describedby");

    expect(field.getAttribute("aria-invalid")).toBe("true");

    // The element the field points at has to exist and carry the message;
    // looking it up and then reading through a null would assert nothing.
    const message = describedBy ? document.getElementById(describedBy) : null;

    expect(message).not.toBeNull();
    expect(message?.textContent).toContain(
      "Choose an attribute for this condition.",
    );
  });

  it("stops calling the field invalid once an attribute is chosen", () => {
    renderOne(typed({ attribute: "beta", values: "true" }));

    expect(
      screen.getByLabelText("Attribute for condition 1").getAttribute(
        "aria-invalid",
      ),
    ).toBeNull();
  });
});
