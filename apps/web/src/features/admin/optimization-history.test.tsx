import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { OptimizationHistory } from "./optimization-history";
import type { OptimizationRun } from "@/lib/business-workspace";

describe("OptimizationHistory", () => {
  it("is discoverable with a clear empty state before the first optimization", () => {
    render(<OptimizationHistory runs={[]} onCreateDraft={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Povijest optimizacija" })).toBeInTheDocument();
    expect(screen.getByText("Još nema spremljenih optimizacija.")).toBeInTheDocument();
    expect(screen.getByText(/automatski će se pojaviti ovdje/i)).toBeInTheDocument();
  });

  it("uses the native expandable disclosure without losing stored runs", () => {
    const run: OptimizationRun = {
      id: "run-1", draft_id: "draft-1", draft_name: "Jutarnji plan", created_at: "2026-01-01T08:00:00.000Z",
      source_snapshot: { vehicles: [], machines: [], locations: [], orders: [], parameters: { depot_location_id: "L0", max_driving_minutes: 540, pickup_service_minutes: 20, delivery_service_minutes: 20 } },
      result: { status: "INFEASIBLE", solver_status: 0, solver_duration_seconds: 0, plan: null, validation_result: null, violations: [], baseline_comparison: null, diagnostic_message: null },
      outcome: "INFEASIBLE", failure: { message: "Dokazana neizvedivost plana.", affected_order_ids: [], constraint_details: [], corrective_guidance: null },
      optimization_strategy: "BALANCED" as const, require_all_selected_vehicles: false, selected_vehicle_ids: ["A"], selected_order_ids: ["N01"],
    };
    render(<OptimizationHistory runs={[run]} onCreateDraft={vi.fn()} onDelete={vi.fn()} />);
    const summary = screen.getByText("Jutarnji plan", { selector: "strong" });
    fireEvent.click(summary);
    expect(screen.getByText("Zašto optimizacija nije uspjela?")).toBeInTheDocument();
    expect(screen.getByText("Uravnoteženo")).toBeInTheDocument();
  });
});
