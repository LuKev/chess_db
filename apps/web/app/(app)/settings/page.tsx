import Link from "next/link";

export default function SettingsPage() {
  return (
    <main>
      <section className="card">
        <div className="section-head">
          <h2>Settings</h2>
          <div className="button-row">
            <Link href="/diagnostics">Diagnostics</Link>
          </div>
        </div>
        <p className="muted">User settings UI is being extracted from Diagnostics next.</p>
      </section>
    </main>
  );
}

