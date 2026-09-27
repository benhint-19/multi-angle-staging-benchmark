import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CATEGORY_LIST, INVENTORY_PROMPT, MATCH_PROMPT_TEMPLATE, QUALITY_PROMPT, SYSTEM_PROMPT, VISIBILITY_PROMPT_TEMPLATE } from "../src/prompts.js";

const protocol = readFileSync(new URL("../../PROTOCOL.md", import.meta.url), "utf8");

describe("PROTOCOL.md publishes the judge prompts verbatim", () => {
  it.each([
    ["system", SYSTEM_PROMPT],
    ["inventory", INVENTORY_PROMPT],
    ["match", MATCH_PROMPT_TEMPLATE],
    ["visibility", VISIBILITY_PROMPT_TEMPLATE],
    ["quality", QUALITY_PROMPT],
    ["categories", CATEGORY_LIST],
  ])("%s prompt", (_name, text) => {
    expect(protocol).toContain(text);
  });
});
