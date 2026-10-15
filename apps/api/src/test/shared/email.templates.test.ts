import { describe, expect, it } from "vitest";

import { EmailRenderer } from "../../modules/email/email.renderer.js";
import type {
  EmailTemplateId,
  EmailTemplateVariables,
} from "../../modules/email/email.templates.js";

const code = "481920";

const samples: { [Id in EmailTemplateId]: EmailTemplateVariables<Id> } = {
  passwordResetCode: { name: "Ada", code, expiresInMinutes: 10 },
  verifyEmailCode: { name: "Ada", code, expiresInMinutes: 10 },
};

const renderer = new EmailRenderer();

describe("every registered template", () => {
  it("renders a subject, a text alternative and HTML from its .mjml file", async () => {
    for (const id of Object.keys(samples) as EmailTemplateId[]) {
      const rendered = await renderer.render(id, samples[id]);

      expect(rendered.subject.length).toBeGreaterThan(0);
      expect(rendered.text.length).toBeGreaterThan(0);
      expect(rendered.html.startsWith("<!doctype html>")).toBe(true);
      // A placeholder the schema does not supply would survive as literal text.
      expect(rendered.html).not.toContain("{{");
      expect(rendered.text).not.toContain("{{");
    }
  });

  it("fails at construction when the template assets are missing", () => {
    expect(() => new EmailRenderer("/nonexistent-templates")).toThrow();
  });
});

describe("password reset code template", () => {
  it("carries the code rather than anything to click", async () => {
    const { text, html } = await renderer.render("passwordResetCode", {
      code,
      expiresInMinutes: 10,
    });

    expect(text).toContain(code);
    expect(html).toContain(code);
    // The reset flow is a code now; an anchor here would send the user back out
    // to the API origin, which is the whole thing this replaced.
    expect(html).not.toContain("<a ");
    expect(text).not.toContain("http");
  });

  it("quotes the configured expiry in both bodies", async () => {
    const { text, html } = await renderer.render("passwordResetCode", {
      code,
      expiresInMinutes: 10,
    });

    expect(text).toContain("expires in 10 minutes");
    expect(html).toContain("expires in 10 minutes");
  });

  it("greets a named recipient and escapes the name", async () => {
    const { text, html } = await renderer.render("passwordResetCode", {
      name: "Ada <ada@example.com>",
      code,
      expiresInMinutes: 10,
    });

    expect(text).toContain("Hi Ada <ada@example.com>,");
    expect(html).toContain("Hi Ada &lt;ada@example.com&gt;,");
    expect(html).not.toContain("<ada@example.com>");
  });

  it("uses a neutral greeting when the name is unknown", async () => {
    const { text, html } = await renderer.render("passwordResetCode", {
      code,
      expiresInMinutes: 10,
    });

    expect(text.startsWith("Hi,")).toBe(true);
    expect(html).toContain("Hi,");
  });
});

describe("verify email code template", () => {
  it("renders the code the sign-up flow sends", async () => {
    const rendered = await renderer.render("verifyEmailCode", {
      code,
      expiresInMinutes: 10,
      name: "Ada",
    });

    expect(rendered.subject).toBe("Your Iwifunni confirmation code");
    expect(rendered.text).toContain(code);
    expect(rendered.html).toContain(code);
    expect(rendered.text).toContain("10 minutes");
  });

  it("uses a neutral greeting when the name is unknown", async () => {
    const { text } = await renderer.render("verifyEmailCode", {
      code,
      expiresInMinutes: 10,
    });

    expect(text.startsWith("Hi,")).toBe(true);
  });
});
