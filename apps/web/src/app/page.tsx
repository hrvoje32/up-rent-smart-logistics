import Link from "next/link";
import Image from "next/image";

export default function HomePage() {
  return (
    <main className="landing-page">
      <section className="landing-page__content" aria-labelledby="landing-title">
        <Image className="landing-page__brand" src="/up-rent-brand.svg" width={1200} height={900} priority alt="UP RENT" />
        <p className="eyebrow">UP RENT SMART LOGISTICS</p>
        <h1 id="landing-title">Planiranje prijevoza strojeva</h1>
        <p>Pregledajte naloge, vozila i provjereni raspored prije početka operacija.</p>
        <Link className="landing-page__cta" href="/admin/dashboard">Otvori nadzornu ploču</Link>
      </section>
    </main>
  );
}
