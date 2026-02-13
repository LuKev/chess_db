import Link from "next/link";

export default function ExportsPage() {
  return (
    <main>
      <section className="card">
        <div className="section-head">
          <h2>Exports</h2>
          <div className="button-row">
            <Link href="/diagnostics">Diagnostics</Link>
          </div>
        </div>
        <p className="muted">Export UI is being extracted from Diagnostics next.</p>
      </section>
    </main>
  );
}

