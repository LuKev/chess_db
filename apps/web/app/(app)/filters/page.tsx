import Link from "next/link";

export default function FiltersPage() {
  return (
    <main>
      <section className="card">
        <div className="section-head">
          <h2>Saved Filters</h2>
          <div className="button-row">
            <Link href="/diagnostics">Diagnostics</Link>
          </div>
        </div>
        <p className="muted">Saved-filter management UI is being extracted from Diagnostics next.</p>
      </section>
    </main>
  );
}

