import { describe, expect, it } from "vitest";
import { optionalEnv, requireEnv } from "./env.js";

describe("requireEnv", () => {
  it("returns the value when set", () => {
    const env = { FOO: "bar" };
    const prev = process.env.FOO;
    process.env.FOO = env.FOO;
    try {
      expect(requireEnv("FOO", "hint")).toBe("bar");
    } finally {
      if (prev === undefined) delete process.env.FOO;
      else process.env.FOO = prev;
    }
  });

  it("throws an actionable error including the hint when unset", () => {
    const prev = process.env.DEFINITELY_NOT_SET;
    delete process.env.DEFINITELY_NOT_SET;
    try {
      expect(() => requireEnv("DEFINITELY_NOT_SET", "See README.md")).toThrow(
        /DEFINITELY_NOT_SET is not set\. See README\.md/,
      );
    } finally {
      if (prev !== undefined) process.env.DEFINITELY_NOT_SET = prev;
    }
  });

  it("throws when the value is only whitespace", () => {
    const prev = process.env.BLANK_VAR;
    process.env.BLANK_VAR = "   ";
    try {
      expect(() => requireEnv("BLANK_VAR", "hint")).toThrow();
    } finally {
      if (prev === undefined) delete process.env.BLANK_VAR;
      else process.env.BLANK_VAR = prev;
    }
  });
});

describe("optionalEnv", () => {
  it("returns the fallback when unset", () => {
    const prev = process.env.NOT_SET_EITHER;
    delete process.env.NOT_SET_EITHER;
    try {
      expect(optionalEnv("NOT_SET_EITHER", "default-value")).toBe("default-value");
    } finally {
      if (prev !== undefined) process.env.NOT_SET_EITHER = prev;
    }
  });
});
