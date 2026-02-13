import Link from "next/link";

export default function TagsPage() {
  return (
    <main>
      <section className="card">
        <div className="section-head">
          <h2>Tags</h2>
          <div className="button-row">
            <Link href="/diagnostics">Diagnostics</Link>
          </div>
        </div>
        <p className="muted">Tags UI is being extracted from Diagnostics next.</p>
      </section>
    </main>
  );
}

