import Link from "next/link";

export default function DeadLettersPage() {
  return (
    <main>
      <section className="card">
        <div className="section-head">
          <h2>Dead Letters</h2>
          <div className="button-row">
            <Link href="/diagnostics">Diagnostics</Link>
          </div>
        </div>
        <p className="muted">Dead-letter inspection UI is being extracted from Diagnostics next.</p>
      </section>
    </main>
  );
}

