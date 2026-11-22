import { notFound, redirect } from "next/navigation";

import { ManagementPage, type ManagementSection } from "@/features/admin/management-page";
import { getDemoDataset } from "@/lib/optimizer-api";

// The optimizer Service binding is injected only when the web function runs.
export const dynamic = "force-dynamic";

const sections = ["dashboard", "orders", "vehicles", "machines", "locations"] as const;

export default async function AdminManagementPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (!sections.includes(section as ManagementSection)) notFound();
  if (section === "machines" || section === "locations") redirect("/admin/orders");
  return <ManagementPage dataset={await getDemoDataset()} section={section as ManagementSection} />;
}
