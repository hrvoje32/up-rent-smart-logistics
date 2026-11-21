import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import HomePage from "./page";

describe("HomePage", () => {
  it("renders the Task 00 foundation message", () => {
    render(<HomePage />);

    expect(screen.getByRole("heading", { name: /smart logistics planner/i })).toBeInTheDocument();
    expect(screen.getByText(/repository foundation is ready/i)).toBeInTheDocument();
  });
});
