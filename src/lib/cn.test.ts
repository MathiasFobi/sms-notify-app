import { describe, expect, it } from "vitest";
import { cn } from "@/lib/cn";

describe("cn()", () => {
  it("merges class names and filters out falsy values", () => {
    expect(cn("px-2", "py-2", false && "hidden", undefined, "text-sm")).toBe(
      "px-2 py-2 text-sm",
    );
  });

  it("resolves conflicting Tailwind utilities (later wins)", () => {
    // twMerge should drop px-2 in favor of px-4
    expect(cn("px-2", "px-4")).toBe("px-4");
  });
});
