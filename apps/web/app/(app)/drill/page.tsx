"use client";

import { Chess } from "chess.js";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FenPreviewBoard } from "../../../components/FenPreviewBoard";
import { useToasts } from "../../../components/ToastsProvider";
import { fetchJson } from "../../../lib/api";

type RepertoireItem = {
  id: number;
  name: string;
  description: string | null;
  orientation: "white" | "black" | "either";
  entryCount: number;
  practicedCount: number;
};

type RepertoireListResponse = {
  items: RepertoireItem[];
};

type DrillOption = {
  id: number;
  moveUci: string;
  moveSan: string | null;
  note: string | null;
  practiceCount: number;
  correctCount: number;
};

type DrillPrompt = {
  repertoireId: number;
  positionFen: string;
  fenNorm: string;
  totalCandidates: number;
  totalPractice: number;
  options: DrillOption[];
};

function toAnswerChoices(positionFen: string, options: DrillOption[]): Array<{ moveUci: string; label: string; correct: boolean }> {
  try {
    const normalizedFen =
      positionFen && positionFen !== "startpos" && positionFen.trim().split(/\s+/).length === 4 ? `${positionFen} 0 1` : positionFen;
    const chess = new Chess(normalizedFen === "startpos" ? undefined : normalizedFen || undefined);
    const correctMoves = new Set(options.map((option) => option.moveUci.toLowerCase()));
    const distractors = chess
      .moves({ verbose: true })
      .map((move) => ({
        moveUci: `${move.from}${move.to}${move.promotion ?? ""}`.toLowerCase(),
        label: move.san,
      }))
      .filter((move) => !correctMoves.has(move.moveUci))
      .slice(0, Math.max(0, 4 - options.length));

    const choices = [
      ...options.map((option) => ({
        moveUci: option.moveUci.toLowerCase(),
        label: option.moveSan ?? option.moveUci,
        correct: true,
      })),
      ...distractors.map((move) => ({
        moveUci: move.moveUci,
        label: move.label,
        correct: false,
      })),
    ];

    return choices.sort((a, b) => a.label.localeCompare(b.label));
  } catch {
    return options.map((option) => ({
      moveUci: option.moveUci.toLowerCase(),
      label: option.moveSan ?? option.moveUci,
      correct: true,
    }));
  }
}

export default function DrillPage() {
  const searchParams = useSearchParams();
  const toasts = useToasts();
  const [selectedRepertoireId, setSelectedRepertoireId] = useState<number | null>(null);
  const [prompt, setPrompt] = useState<DrillPrompt | null>(null);
  const [status, setStatus] = useState("Select a repertoire and load the next drill position.");
  const [loadingPrompt, setLoadingPrompt] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [sessionCorrect, setSessionCorrect] = useState(0);
  const [sessionAttempts, setSessionAttempts] = useState(0);

  const repertoires = useQuery({
    queryKey: ["repertoires"],
    queryFn: async (): Promise<RepertoireItem[]> => {
      const response = await fetchJson<RepertoireListResponse>("/api/repertoires", { method: "GET" });
      if (response.status === 200 && "items" in response.data) {
        return response.data.items;
      }
      const msg =
        "error" in response.data && response.data.error
          ? response.data.error
          : `Failed to load repertoires (status ${response.status})`;
      throw new Error(msg);
    },
  });

  useEffect(() => {
    const raw = searchParams.get("repertoireId");
    if (!raw) {
      return;
    }
    const repertoireId = Number(raw);
    if (Number.isInteger(repertoireId) && repertoireId > 0) {
      setSelectedRepertoireId(repertoireId);
    }
  }, [searchParams]);

  useEffect(() => {
    if (!repertoires.data || repertoires.data.length === 0) {
      return;
    }
    if (selectedRepertoireId && repertoires.data.some((item) => item.id === selectedRepertoireId)) {
      return;
    }
    setSelectedRepertoireId(repertoires.data[0].id);
  }, [repertoires.data, selectedRepertoireId]);

  const selectedRepertoire = repertoires.data?.find((item) => item.id === selectedRepertoireId) ?? null;
  const answerChoices = useMemo(
    () => (prompt ? toAnswerChoices(prompt.positionFen, prompt.options) : []),
    [prompt]
  );

  async function loadNextPrompt(): Promise<void> {
    if (!selectedRepertoireId) {
      toasts.pushToast({ kind: "error", message: "Choose a repertoire first" });
      return;
    }
    setLoadingPrompt(true);
    setRevealed(false);
    const response = await fetchJson<DrillPrompt>(`/api/repertoires/${selectedRepertoireId}/drill/next`, {
      method: "GET",
    });
    setLoadingPrompt(false);
    if (response.status !== 200 || !("options" in response.data)) {
      const msg =
        "error" in response.data && response.data.error
          ? response.data.error
          : `Failed to load drill prompt (status ${response.status})`;
      setStatus(msg);
      setPrompt(null);
      toasts.pushToast({ kind: "error", message: msg });
      return;
    }
    setPrompt(response.data);
    setStatus(`Loaded a drill position from ${selectedRepertoire?.name ?? `repertoire #${selectedRepertoireId}`}.`);
  }

  async function submitAnswer(choice: { moveUci: string; label: string; correct: boolean }): Promise<void> {
    if (!prompt) {
      return;
    }
    setSessionAttempts((value) => value + 1);
    const matched = prompt.options.find((option) => option.moveUci.toLowerCase() === choice.moveUci);
    const targetEntry = matched ?? prompt.options[0] ?? null;
    if (!targetEntry) {
      return;
    }

    const response = await fetchJson<{ id: number; correctCount: number; practiceCount: number }>(
      `/api/repertoire-entries/${targetEntry.id}/drill-result`,
      {
        method: "POST",
        body: JSON.stringify({ correct: choice.correct }),
      }
    );
    if (response.status !== 200) {
      const msg =
        "error" in response.data && response.data.error
          ? response.data.error
          : `Failed to submit drill result (status ${response.status})`;
      setStatus(msg);
      toasts.pushToast({ kind: "error", message: msg });
      return;
    }

    if (choice.correct) {
      setSessionCorrect((value) => value + 1);
      setStatus(`Correct: ${choice.label}. Loading the next position...`);
      toasts.pushToast({ kind: "success", message: "Correct move" });
      await loadNextPrompt();
      return;
    }

    setStatus(
      `Incorrect: ${choice.label}. Repertoire move${prompt.options.length > 1 ? "s" : ""}: ${prompt.options
        .map((option) => option.moveSan ?? option.moveUci)
        .join(", ")}.`
    );
    setRevealed(true);
    toasts.pushToast({ kind: "error", message: "Incorrect move" });
  }

  return (
    <main>
      <section className="card">
        <div className="section-head">
          <h2>Drill Mode</h2>
          <div className="button-row">
            <Link href="/repertoires">Repertoires</Link>
            <Link href="/games">Games</Link>
            <Link href="/diagnostics">Diagnostics</Link>
          </div>
        </div>
        <p className="muted">Quiz yourself on stored repertoire positions with plausible legal alternatives mixed in.</p>
      </section>

      <section className="card">
        <div className="auth-grid">
          <label>
            Repertoire
            <select
              value={selectedRepertoireId ?? ""}
              onChange={(event) => setSelectedRepertoireId(event.target.value ? Number(event.target.value) : null)}
            >
              <option value="">Select a repertoire</option>
              {(repertoires.data ?? []).map((repertoire) => (
                <option key={repertoire.id} value={repertoire.id}>
                  {repertoire.name}
                </option>
              ))}
            </select>
          </label>
          <div className="button-row" style={{ alignSelf: "end" }}>
            <button type="button" onClick={() => void loadNextPrompt()} disabled={!selectedRepertoireId || loadingPrompt}>
              {prompt ? "Next position" : "Start drill"}
            </button>
          </div>
        </div>
        <p className="muted">{status}</p>
        {selectedRepertoire ? (
          <p className="muted">
            {selectedRepertoire.entryCount} entries, {selectedRepertoire.practicedCount} practiced.
            Session: {sessionCorrect}/{sessionAttempts} correct.
          </p>
        ) : null}
      </section>

      {prompt ? (
        <>
          <section className="card">
            <FenPreviewBoard fen={prompt.positionFen} title="Current Drill Position" />
          </section>

          <section className="card">
            <h2>Choose the repertoire move</h2>
            <div className="button-row">
              {answerChoices.map((choice) => (
                <button key={choice.moveUci} type="button" onClick={() => void submitAnswer(choice)}>
                  {choice.label}
                </button>
              ))}
            </div>
            <p className="muted">
              {prompt.totalCandidates} repertoire move{prompt.totalCandidates === 1 ? "" : "s"} stored for this position.
            </p>
            {revealed ? (
              <div className="table-wrap">
                <table style={{ minWidth: 700 }}>
                  <thead>
                    <tr>
                      <th>Move</th>
                      <th>Note</th>
                      <th>Drill Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {prompt.options.map((option) => (
                      <tr key={option.id}>
                        <td>
                          <strong>{option.moveSan ?? option.moveUci}</strong>
                          <div className="muted muted-small">{option.moveUci}</div>
                        </td>
                        <td>{option.note ?? "-"}</td>
                        <td>
                          {option.correctCount}/{option.practiceCount}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>
        </>
      ) : (
        <section className="card">
          <p className="muted">No drill prompt loaded yet.</p>
        </section>
      )}
    </main>
  );
}
