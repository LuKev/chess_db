import Link from "next/link";

export default function CollectionsPage() {
  return (
    <main>
      <section className="card">
        <div className="section-head">
          <h2>Collections</h2>
          <div className="button-row">
            <Link href="/diagnostics">Diagnostics</Link>
          </div>
        </div>
        <p className="muted">Collections UI is being extracted from Diagnostics next.</p>
      </section>
    </main>
  );
}

