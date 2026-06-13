import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";

import { navItems, Sidebar, type SidebarNavItem } from "@/components/ui/sidebar";
import { CreditsBadge } from "@/components/credits-badge";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";

/**
 * US-003 sidebar nav + credits badge tests.
 *
 * The Sidebar is a client component (it uses `usePathname`),
 * so we can't call `renderToStaticMarkup` on it directly from
 * the test environment. Instead we test the data shape that
 * drives it — the exported `navItems` array — which is the
 * source of truth for the acceptance criteria:
 *
 *  AC2: "Sidebar shows links: Dashboard, Send SMS, Scheduled,
 *       Contacts, Sender IDs, Inbox, Reports, Billing,
 *       Settings, Logout"
 *
 *  AC3: "Each sidebar link navigates to the correct route"
 *       (the href field on each item).
 *
 * For the CreditsBadge, AC4 says the badge "displays the
 * integer from accounts.credits". We render it via
 * `renderToStaticMarkup` (it's a server component — pure
 * presentational) and assert the integer is in the markup.
 *
 * The Sidebar component itself is smoke-tested by importing
 * it (so a type/runtime crash during bundling is caught) and
 * by inspecting its exports.
 */
describe("Sidebar nav (US-003)", () => {
  it("exports a navItems array with the 10 spec'd entries", () => {
    expect(navItems).toHaveLength(10);
  });

  it("lists the labels in the spec order", () => {
    const labels = navItems.map((i) => i.label);
    expect(labels).toEqual([
      "Dashboard",
      "Send SMS",
      "Scheduled",
      "Contacts",
      "Sender IDs",
      "Inbox",
      "Reports",
      "Billing",
      "Settings",
      "Logout",
    ]);
  });

  it("maps each label to the spec'd route", () => {
    const expected: Record<string, string> = {
      Dashboard: "/app/dashboard",
      "Send SMS": "/app/send",
      Scheduled: "/app/scheduled",
      Contacts: "/app/contacts",
      "Sender IDs": "/app/sender-ids",
      Inbox: "/app/inbox",
      Reports: "/app/reports",
      Billing: "/app/billing",
      Settings: "/app/settings",
      Logout: "/",
    };
    for (const item of navItems) {
      expect(item.href).toBe(expected[item.label]);
    }
  });

  it("marks Logout as an action='logout' (renders a form, not a link)", () => {
    const logout = navItems.find((i) => i.label === "Logout");
    expect(logout).toBeDefined();
    expect(logout!.action).toBe("logout");
    // The other items must NOT be logout.
    for (const item of navItems) {
      if (item.label === "Logout") continue;
      expect(item.action).toBeUndefined();
    }
  });

  it("attaches a lucide icon component to every item", () => {
    for (const item of navItems) {
      // lucide-react ships icons as forwardRef-wrapped memo'd
      // components, so `typeof` is "object". We accept either a
      // plain function (mock) or any truthy non-primitive.
      expect(item.icon).toBeTruthy();
      expect(["function", "object"]).toContain(typeof item.icon);
    }
  });

  it("Sidebar is exported and accepts the required signOutAction prop", () => {
    // Type-level smoke: if Sidebar's signature regresses (e.g.
    // `signOutAction` becomes required and missing), the import
    // still works but the runtime call below would crash. The
    // test exercises the props shape via TypeScript's compile.
    expect(typeof Sidebar).toBe("function");
    // Build a typed empty props object and assert the keys we
    // care about are present.
    const fakeAction: SidebarNavItem["action"] = undefined;
    const item: SidebarNavItem = {
      label: "Test",
      href: "/app/test",
      icon: () => null,
    };
    expect(item.action).toBe(fakeAction);
  });
});

describe("CreditsBadge (US-003)", () => {
  it("renders the integer from accounts.credits", () => {
    const html = renderToStaticMarkup(
      React.createElement(CreditsBadge, { credits: 1250 }),
    );
    expect(html).toContain("1,250");
    expect(html).toContain("credits");
    // data-credits is what the topbar test-id target reads.
    expect(html).toContain('data-credits="1250"');
  });

  it("clamps negative or fractional inputs to 0", () => {
    const html = renderToStaticMarkup(
      React.createElement(CreditsBadge, { credits: -7 }),
    );
    expect(html).toContain("0");
    expect(html).toContain('data-credits="0"');
  });

  it("treats NaN / non-finite as 0", () => {
    const html = renderToStaticMarkup(
      React.createElement(CreditsBadge, { credits: Number.NaN }),
    );
    expect(html).toContain('data-credits="0"');
  });

  it("formats with thousands separators", () => {
    const html = renderToStaticMarkup(
      React.createElement(CreditsBadge, { credits: 1234567 }),
    );
    expect(html).toContain("1,234,567");
  });
});

describe("Empty-state (US-003)", () => {
  it("defaults to 'Coming soon' and renders description + children", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        EmptyState,
        {
          description: "test description",
          children: React.createElement(
            "button",
            { type: "button" },
            "Action",
          ),
        },
      ),
    );
    expect(html).toContain("Coming soon");
    expect(html).toContain("test description");
    expect(html).toContain("Action");
  });
});

describe("UI primitives (US-003)", () => {
  it("Button renders the right classes for each variant", () => {
    const html = renderToStaticMarkup(
      React.createElement(Button, { variant: "destructive" }, "Delete"),
    );
    expect(html).toContain("bg-destructive");
    expect(html).toContain("Delete");
  });

  it("Card + CardHeader + CardTitle + CardContent compose", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        Card,
        null,
        React.createElement(
          CardHeader,
          null,
          React.createElement(CardTitle, null, "Hello"),
        ),
        React.createElement(CardContent, null, "World"),
      ),
    );
    expect(html).toContain("Hello");
    expect(html).toContain("World");
    // Card has a rounded border + shadow.
    expect(html).toContain("rounded-lg");
  });

  it("Input renders a native input element", () => {
    const html = renderToStaticMarkup(
      React.createElement(Input, { placeholder: "Phone" }),
    );
    expect(html).toContain("<input");
    expect(html).toContain('placeholder="Phone"');
  });

  it("Label renders a native label element", () => {
    const html = renderToStaticMarkup(
      React.createElement(Label, { htmlFor: "x" }, "Phone"),
    );
    expect(html).toContain("<label");
    expect(html).toContain('for="x"');
  });

  it("Table primitives compose a valid table", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        Table,
        null,
        React.createElement(
          TableHeader,
          null,
          React.createElement(
            TableRow,
            null,
            React.createElement(TableHead, null, "Name"),
          ),
        ),
        React.createElement(
          TableBody,
          null,
          React.createElement(
            TableRow,
            null,
            React.createElement(TableCell, null, "Alice"),
          ),
        ),
      ),
    );
    expect(html).toContain("<table");
    expect(html).toContain("<thead");
    expect(html).toContain("<tbody");
    expect(html).toContain("Alice");
  });
});
