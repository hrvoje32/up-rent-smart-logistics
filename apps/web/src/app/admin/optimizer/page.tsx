import { OptimizerDashboard } from "@/features/admin/optimizer-dashboard";
import { getDemoDataset, OptimizerApiError } from "@/lib/optimizer-api";

export const dynamic = "force-dynamic";

async function loadDashboardProps(): Promise<{ dataset: Awaited<ReturnType<typeof getDemoDataset>> | null; initialError: string | null }> {
  try {
    return { dataset: await getDemoDataset(), initialError: null };
  } catch (error) {
    const message = error instanceof OptimizerApiError ? error.message : "Kanonski skup podataka za planiranje nije moguće učitati.";
    return { dataset: null, initialError: message };
  }
}

export default async function OptimizerPage() {
  const props = await loadDashboardProps();
  return <OptimizerDashboard {...props} />;
}
