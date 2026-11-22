import { describe, expect, it } from "vitest";

import { distance, duration, plural, weight } from "./format";

describe("duration", () => {
  it("preserves seconds instead of rounding durations", () => {
    expect(duration(11_016)).toBe("3 h 3 min 36 s");
    expect(duration(12_000)).toBe("3 h 20 min");
    expect(duration(0)).toBe("0 min");
  });
});

describe("Croatian formatting", () => {
  it("uses decimal comma, thousands separator, and Croatian plurals", () => {
    expect(distance(1822)).toBe("182,2 km");
    expect(weight(9400)).toBe("9.400 kg");
    expect(plural(1, "order")).toBe("1 nalog");
    expect(plural(2, "order")).toBe("2 naloga");
    expect(plural(5, "order")).toBe("5 naloga");
    expect(plural(2, "machine")).toBe("2 stroja");
    expect(plural(5, "machine")).toBe("5 strojeva");
  });
});
