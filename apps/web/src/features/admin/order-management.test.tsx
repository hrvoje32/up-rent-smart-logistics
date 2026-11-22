import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OrderManagement } from "./order-management";
import type { DemoDataset } from "@/types/optimizer-api";

const dataset: DemoDataset = {
  vehicles: [{ id: "A", max_payload_kg: 3500, max_simultaneous_machines: 2, start_location_id: "L0", end_location_id: "L0", average_speed_kmh: 60 }],
  machines: [{ id: "M01", weight_kg: 800 }], locations: [{ id: "L0", x: 0, y: 0 }, { id: "L1", x: 2, y: 3 }],
  orders: [{ id: "N01", machine_id: "M01", pickup_location_id: "L0", delivery_location_id: "L1" }],
  parameters: { depot_location_id: "L0", max_driving_minutes: 540, pickup_service_minutes: 20, delivery_service_minutes: 20 },
};

afterEach(() => { cleanup(); window.localStorage.clear(); });

function orderRows(): HTMLElement[] { return screen.getAllByRole("row").slice(1); }

describe("OrderManagement", () => {
  it("uses a drawer while creating machine, location and timezone-aware order records without losing the parent draft", async () => {
    render(<OrderManagement dataset={dataset} />);
    await screen.findByLabelText("Tablica transportnih naloga");
    expect(screen.queryByLabelText("ID naloga")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dodaj nalog" }));
    expect(screen.getByRole("dialog", { name: "Dodaj transportni nalog" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("ID naloga"), { target: { value: "N02" } });
    fireEvent.change(screen.getByLabelText("Napomena"), { target: { value: "Hitna isporuka" } });
    fireEvent.click(screen.getByRole("button", { name: "Dodaj stroj" }));
    expect(screen.getByRole("dialog", { name: "Dodaj stroj" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("ID stroja"), { target: { value: "M02" } });
    fireEvent.change(screen.getByLabelText("Naziv stroja"), { target: { value: "Bager 2" } });
    fireEvent.change(screen.getByLabelText("Masa (kg)"), { target: { value: "1500" } });
    fireEvent.click(screen.getByRole("button", { name: "Spremi stroj" }));
    expect(screen.queryByRole("dialog", { name: "Dodaj stroj" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("ID naloga")).toHaveValue("N02");
    expect(screen.getByLabelText("Napomena")).toHaveValue("Hitna isporuka");
    expect(screen.getByText("Bager 2 · 1.500 kg", { selector: ".selected-machine strong" })).toBeInTheDocument();
    const pickup = screen.getByRole("group", { name: "Preuzimanje" });
    fireEvent.click(within(pickup).getByRole("button", { name: "Dodaj lokaciju" }));
    fireEvent.change(screen.getByLabelText("ID lokacije"), { target: { value: "L2" } });
    fireEvent.change(screen.getByLabelText("Naziv lokacije"), { target: { value: "Gradilište" } });
    fireEvent.change(screen.getByLabelText("X koordinata"), { target: { value: "-4.5" } });
    fireEvent.change(screen.getByLabelText("Y koordinata"), { target: { value: "6" } });
    fireEvent.click(screen.getByRole("button", { name: "Spremi lokaciju" }));
    expect(screen.getByLabelText("Lokacija preuzimanja")).toHaveValue("L2");
    fireEvent.change(screen.getByLabelText("Najranije preuzimanje"), { target: { value: "2026-01-15T08:00" } });
    fireEvent.change(screen.getByLabelText("Najkasnije preuzimanje"), { target: { value: "2026-01-15T10:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Spremi nalog" }));
    expect(screen.getByRole("row", { name: /N02/ })).toHaveTextContent(/Bager 2.*1\.500 kg.*L2/is);
    await waitFor(() => expect(window.localStorage.getItem("up-rent.business-workspace.v1")).toContain("N02"));
    const stored = JSON.parse(String(window.localStorage.getItem("up-rent.business-workspace.v1"))) as { orders: Array<{ id: string; earliest_pickup_at: string | null; machine_id: string }>; locations: Array<{ id: string; x: number }> };
    expect(stored.orders.find((order) => order.id === "N02")).toMatchObject({ machine_id: "M02", earliest_pickup_at: "2026-01-15T08:00:00+01:00" });
    expect(stored.locations.find((location) => location.id === "L2")?.x).toBe(-4.5);
  });

  it("opens details, edits, changes status and confirms deletion from the contextual action menu", async () => {
    render(<OrderManagement dataset={dataset} />);
    await screen.findByLabelText("Tablica transportnih naloga");
    const row = screen.getByRole("row", { name: /N01/ });
    fireEvent.click(within(row).getByRole("button", { name: "Detalji" }));
    expect(screen.getByRole("dialog", { name: "N01" })).toHaveTextContent(/operativni status, ne potvrda fizičkog izvršenja/i);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "N01" })).not.toBeInTheDocument();
    fireEvent.click(within(row).getByRole("button", { name: "Radnje za nalog N01" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Uredi" }));
    fireEvent.change(screen.getByLabelText("Napomena"), { target: { value: "Ažurirano" } });
    fireEvent.click(screen.getByRole("button", { name: "Spremi promjene" }));
    expect(screen.getByRole("status")).toHaveTextContent(/ažuriran/i);
    fireEvent.click(within(screen.getByRole("row", { name: /N01/ })).getByRole("button", { name: "Radnje za nalog N01" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Otkaži nalog" }));
    expect(screen.getByRole("status")).toHaveTextContent(/status naloga N01 je ažuriran/i);
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "CANCELLED" } });
    expect(screen.getByRole("row", { name: /N01/ })).toHaveTextContent("Otkazan");
    fireEvent.click(within(screen.getByRole("row", { name: /N01/ })).getByRole("button", { name: "Radnje za nalog N01" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Obriši nalog" }));
    expect(screen.getByRole("dialog", { name: "Obrisati nalog?" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Odustani" }));
    expect(screen.getByRole("row", { name: /N01/ })).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("row", { name: /N01/ })).getByRole("button", { name: "Radnje za nalog N01" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Obriši nalog" }));
    fireEvent.click(screen.getByRole("button", { name: "Obriši nalog" }));
    expect(screen.queryByRole("row", { name: /N01/ })).not.toBeInTheDocument();
  });

  it("searches, filters, sorts and safely retains an unsaved order when drawer dismissal is cancelled", async () => {
    const sortingDataset: DemoDataset = { ...dataset, orders: [{ id: "N20", machine_id: "M01", pickup_location_id: "L0", delivery_location_id: "L1" }, { id: "N01", machine_id: "M01", pickup_location_id: "L1", delivery_location_id: "L0" }] };
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<OrderManagement dataset={sortingDataset} />);
    await screen.findByLabelText("Tablica transportnih naloga");
    expect(orderRows().map((row) => row.textContent)).toEqual([expect.stringContaining("N01"), expect.stringContaining("N20")]);
    fireEvent.change(screen.getByLabelText("Poredaj prema"), { target: { value: "pickup" } });
    expect(orderRows().map((row) => row.textContent)).toEqual([expect.stringContaining("N20"), expect.stringContaining("N01")]);
    fireEvent.change(screen.getByLabelText("Pretraži naloge"), { target: { value: "N20" } });
    expect(orderRows()).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Pretraži naloge"), { target: { value: "nema" } });
    expect(screen.getByText("Nema naloga za odabrani prikaz.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dodaj nalog" }));
    fireEvent.change(screen.getByLabelText("ID naloga"), { target: { value: "N99" } });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("ID naloga")).toHaveValue("N99");
    fireEvent.click(screen.getByRole("button", { name: "Odustani" }));
    expect(screen.queryByLabelText("ID naloga")).not.toBeInTheDocument();
    confirm.mockRestore();
  });

  it("keeps text focus while typing and uses human-readable location option labels", async () => {
    render(<OrderManagement dataset={dataset} />);
    await screen.findByLabelText("Tablica transportnih naloga");
    fireEvent.click(screen.getByRole("button", { name: "Dodaj nalog" }));
    const notes = screen.getByLabelText("Napomena");
    notes.focus();
    fireEvent.change(notes, { target: { value: "T" } });
    expect(document.activeElement).toBe(notes);
    fireEvent.change(notes, { target: { value: "Transport za Zagreb" } });
    expect(notes).toHaveValue("Transport za Zagreb");
    expect(document.activeElement).toBe(notes);
    expect(within(screen.getByLabelText("Lokacija preuzimanja")).getByRole("option", { name: "Baza / depo" })).toHaveValue("L0");
    expect(within(screen.getByLabelText("Lokacija isporuke")).getByRole("option", { name: "L1" })).toHaveValue("L1");
  });

  it("edits catalog records and blocks deletion while a live order references them", async () => {
    render(<OrderManagement dataset={dataset} />);
    await screen.findByLabelText("Tablica transportnih naloga");
    fireEvent.click(screen.getByRole("button", { name: "Upravljanje katalozima" }));
    expect(screen.getByRole("dialog", { name: "Upravljanje katalozima" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Uredi" }));
    fireEvent.change(screen.getByLabelText("Naziv stroja"), { target: { value: "Bager ažuriran" } });
    fireEvent.change(screen.getByLabelText("Masa (kg)"), { target: { value: "1200" } });
    fireEvent.click(screen.getByRole("button", { name: "Spremi stroj" }));
    expect(screen.getAllByText("Bager ažuriran", { selector: "strong" }).length).toBeGreaterThan(0);
    expect(screen.getByText(/1\.200 kg · 1 nalog/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Obriši" }));
    const confirmation = screen.getByRole("dialog", { name: "Obrisati stroj?" });
    expect(confirmation).toHaveTextContent(/koriste.*N01/i);
    expect(within(confirmation).getByRole("button", { name: "Obriši" })).toBeDisabled();
  });
});
