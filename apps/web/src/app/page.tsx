import Link from "next/link";

export default function HomePage() {
  return (
    <main className="foundation-page">
      <p className="eyebrow">UP RENT</p>
      <h1>Pametni planer logistike</h1>
      <p>
        Lokalna nadzorna ploča spremna je za kanonski demonstracijski skup podataka.
      </p>
      <Link href="/admin/dashboard">Otvori nadzornu ploču</Link>
    </main>
  );
}
