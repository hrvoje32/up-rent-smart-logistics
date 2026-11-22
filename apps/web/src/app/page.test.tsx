import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import HomePage from "./page";

describe("HomePage", () => {
  it("links to the local optimizer", () => {
    render(<HomePage />);

    expect(screen.getByRole("heading", { name: /pametni planer logistike/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /otvori nadzornu ploču/i })).toHaveAttribute("href", "/admin/dashboard");
  });
});
