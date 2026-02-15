import React, { useEffect, useMemo, useRef, useState } from "react";

/** @typedef {"n"|"x"|"d"|"c"} Status */

const LS_KEY = "ps_tracker_v3";
const now = () => Date.now();
const fmtDate = (t) => new Date(t).toLocaleString();
const statusLabel = { n: "未", x: "×", d: "△", c: "✔︎" };
const statusColor = { n: "bg-gray-400", x: "bg-red-500", d: "bg-amber-500", c: "bg-emerald-600" };
const statusText = { n: "text-gray-600", x: "text-red-700", d: "text-amber-700", c: "text-emerald-700" };

function priorityScore(p) {
  const base = p.status === "c" ? 4 : 0;
  const days = p.lastSeenAt ? (now() - p.lastSeenAt) / (1000 * 60 * 60 * 24) : 999;
  const wrongs = p.attempts.filter((a) => a.outcome === "x").length;
  return base + (10 - Math.min(days, 10)) * -0.05 + wrongs * -0.1;
}

function makeDemoSet() {
  const chapters = [
    { id: "ch1", name: "第1章 ベクトル" },
    { id: "ch2", name: "第2章 行列" },
    { id: "ch3", name: "第3章 微分" },
  ];
  const problems = [];
  let idn = 1;
  for (const ch of chapters) {
    const n = ch.id === "ch1" ? 8 : ch.id === "ch2" ? 6 : 10;
    for (let i = 1; i <= n; i++) {
      problems.push({
        id: `p${idn++}`,
        title: `${ch.name} - 問${i}`,
        chapterId: ch.id,
        status: "n",
        tags: [],
        notes: "",
        attempts: [],
        firstCheckedAt: null,
        attemptsToCheck: null,
        lastSeenAt: null,
      });
    }
  }
  return { id: "set_demo", name: "デモ問題集", chapters, problems };
}

function normalizeProblem(raw, index, chapterIdFallback) {
  const status = raw?.status;
  const safeStatus = status === "n" || status === "x" || status === "d" || status === "c" ? status : "n";
  const attemptsRaw = Array.isArray(raw?.attempts) ? raw.attempts : [];
  return {
    id: String(raw?.id ?? `p_${Date.now()}_${index}`),
    title: String(raw?.title ?? `問${index + 1}`),
    chapterId: String(raw?.chapterId ?? chapterIdFallback ?? ""),
    status: safeStatus,
    tags: Array.isArray(raw?.tags) ? raw.tags.map((x) => String(x)) : [],
    notes: String(raw?.notes ?? ""),
    attempts: attemptsRaw
      .map((a) => ({
        outcome: a?.outcome,
        at: Number(a?.at ?? Date.now()),
      }))
      .filter((a) => a.outcome === "n" || a.outcome === "x" || a.outcome === "d" || a.outcome === "c"),
    firstCheckedAt: raw?.firstCheckedAt == null ? null : Number(raw.firstCheckedAt),
    attemptsToCheck: raw?.attemptsToCheck == null ? null : Number(raw.attemptsToCheck),
    lastSeenAt: raw?.lastSeenAt == null ? null : Number(raw.lastSeenAt),
  };
}

function normalizeSets(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return [makeDemoSet()];

  return raw.map((set, setIdx) => {
    const chaptersRaw = Array.isArray(set?.chapters) ? set.chapters : [];
    const chapters = chaptersRaw.length
      ? chaptersRaw.map((ch, i) => ({
          id: String(ch?.id ?? `ch_${Date.now()}_${setIdx}_${i}`),
          name: String(ch?.name ?? `第${i + 1}章`),
        }))
      : [{ id: `ch_${Date.now()}_${setIdx}_0`, name: "第1章" }];

    const defaultChapterId = chapters[0]?.id ?? "";
    const problemsRaw = Array.isArray(set?.problems) ? set.problems : [];
    const problems = problemsRaw.map((p, i) => normalizeProblem(p, i, defaultChapterId));

    return {
      id: String(set?.id ?? `set_${Date.now()}_${setIdx}`),
      name: String(set?.name ?? `問題集${setIdx + 1}`),
      chapters,
      problems,
    };
  });
}

function useHistoryState(initialState) {
  const [state, setState] = useState(initialState);
  const pastRef = useRef([]);
  const futureRef = useRef([]);

  const set = (updater) => {
    setState((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      pastRef.current.push(prev);
      futureRef.current = [];
      return next;
    });
  };

  const undo = () => {
    setState((current) => {
      if (pastRef.current.length === 0) return current;
      const prev = pastRef.current.pop();
      futureRef.current.push(current);
      return prev;
    });
  };

  const redo = () => {
    setState((current) => {
      if (futureRef.current.length === 0) return current;
      const next = futureRef.current.pop();
      pastRef.current.push(current);
      return next;
    });
  };

  return { state, set, undo, redo, canUndo: pastRef.current.length > 0, canRedo: futureRef.current.length > 0 };
}

export default function ProblemSetApp() {
  const persisted = useMemo(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return [makeDemoSet()];
      return normalizeSets(JSON.parse(raw));
    } catch {
      return [makeDemoSet()];
    }
  }, []);

  const { state: sets, set: setSets, undo, redo, canUndo, canRedo } = useHistoryState(persisted);
  const [activeSetId, setActiveSetId] = useState(sets[0]?.id ?? "");

  useEffect(() => {
    localStorage.setItem(LS_KEY, JSON.stringify(sets));
  }, [sets]);

  const active = useMemo(() => sets.find((s) => s.id === activeSetId) ?? sets[0], [sets, activeSetId]);

  const [activeChapterId, setActiveChapterId] = useState(active?.chapters[0]?.id ?? "");
  useEffect(() => {
    setActiveChapterId(active?.chapters[0]?.id ?? "");
  }, [active?.id]);

  const [filterStatus, setFilterStatus] = useState("all");
  const [sortKey, setSortKey] = useState("priority");
  const [searchQuery, setSearchQuery] = useState("");
  const [dailyTarget, setDailyTarget] = useState(20);
  const importInputRef = useRef(null);

  function addSet() {
    const name = prompt("新しい問題集の名前");
    if (!name) return;
    const chapters = [{ id: "ch1", name: "第1章" }];
    const ns = { id: `set_${Date.now()}`, name, chapters, problems: [] };
    setSets([...sets, ns]);
    setActiveSetId(ns.id);
  }

  function addChapter() {
    if (!active) return;
    const raw = prompt("追加する章の数（半角数字）");
    if (!raw) return;
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n <= 0) return alert("1以上の数を入力してください");
    const startIndex = active.chapters.length + 1;
    const newChapters = Array.from({ length: n }, (_, i) => ({
      id: `ch_${Date.now()}_${i}`,
      name: `第${startIndex + i}章`,
    }));
    setSets(sets.map((s) => (s.id === active.id ? { ...s, chapters: [...s.chapters, ...newChapters] } : s)));
  }

  function addProblem() {
    if (!active) return;
    if (active.chapters.length === 0) {
      alert("先に章を追加してください");
      return;
    }
    const chapterId = activeChapterId || active.chapters[0].id;
    const raw = prompt("追加する問題数（半角数字）");
    if (!raw) return;
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n <= 0) return alert("1以上の数を入力してください");

    const existingCount = active.problems.filter((p) => p.chapterId === chapterId).length;
    const newProblems = Array.from({ length: n }, (_, i) => ({
      id: `p_${Date.now()}_${i}`,
      title: `問${existingCount + i + 1}`,
      chapterId,
      status: "n",
      tags: [],
      notes: "",
      attempts: [],
      firstCheckedAt: null,
      attemptsToCheck: null,
      lastSeenAt: null,
    }));
    setSets(sets.map((s) => (s.id === active.id ? { ...s, problems: [...s.problems, ...newProblems] } : s)));
  }

  function renameSet() {
    if (!active) return;
    const name = prompt("問題集名を編集", active.name);
    if (!name) return;
    setSets(sets.map((s) => (s.id === active.id ? { ...s, name } : s)));
  }

  function deleteSet() {
    if (!active) return;
    if (!confirm(`問題集「${active.name}」を削除します。よろしいですか？`)) return;
    const next = sets.filter((s) => s.id !== active.id);
    if (next.length === 0) {
      const demo = makeDemoSet();
      setSets([demo]);
      setActiveSetId(demo.id);
      return;
    }
    setSets(next);
    setActiveSetId(next[0].id);
  }

  function renameChapter() {
    if (!active || !activeChapterId) return;
    const ch = active.chapters.find((c) => c.id === activeChapterId);
    if (!ch) return;
    const name = prompt("章の名前を編集", ch.name);
    if (!name) return;
    setSets(
      sets.map((s) =>
        s.id === active.id ? { ...s, chapters: s.chapters.map((c) => (c.id === ch.id ? { ...c, name } : c)) } : s
      )
    );
  }

  function deleteChapter() {
    if (!active || !activeChapterId) return;
    const ch = active.chapters.find((c) => c.id === activeChapterId);
    if (!ch) return;
    if (!confirm(`章「${ch.name}」とその章の全問題を削除します。よろしいですか？`)) return;

    setSets(
      sets.map((s) => {
        if (s.id !== active.id) return s;
        const chapters = s.chapters.filter((c) => c.id !== ch.id);
        const problems = s.problems.filter((p) => p.chapterId !== ch.id);
        return { ...s, chapters, problems };
      })
    );

    const nextCh = active.chapters.find((c) => c.id !== activeChapterId);
    setActiveChapterId(nextCh ? nextCh.id : "");
  }

  function deleteProblem(problemId) {
    if (!active) return;
    setSets(sets.map((s) => (s.id === active.id ? { ...s, problems: s.problems.filter((p) => p.id !== problemId) } : s)));
  }

  function saveProblemNotes(problemId, notes) {
    if (!active) return;
    setSets(
      sets.map((s) => {
        if (s.id !== active.id) return s;
        return {
          ...s,
          problems: s.problems.map((p) => (p.id === problemId ? { ...p, notes } : p)),
        };
      })
    );
  }

  function advanceProblemStatus(problemId, target) {
    if (!active) return;
    setSets((prev) =>
      prev.map((set) => {
        if (set.id !== active.id) return set;
        const problems = set.problems.map((p) => {
          if (p.id !== problemId) return p;
          const at = now();
          const attempts = [...p.attempts, { outcome: target, at }];
          return { ...p, status: target, attempts, lastSeenAt: at };
        });
        return { ...set, problems };
      })
    );
  }

  function completeProblem(problemId) {
    if (!active) return;
    setSets((prev) =>
      prev.map((set) => {
        if (set.id !== active.id) return set;
        const problems = set.problems.map((p) => {
          if (p.id !== problemId) return p;
          const at = now();
          const becameCheck = p.status !== "c";
          const attempts = [...p.attempts, { outcome: "c", at }];
          const attemptsToCheck = becameCheck && p.attemptsToCheck == null ? attempts.length : p.attemptsToCheck;
          const firstCheckedAt = becameCheck && !p.firstCheckedAt ? at : p.firstCheckedAt;
          return { ...p, status: "c", attempts, lastSeenAt: at, attemptsToCheck, firstCheckedAt };
        });
        return { ...set, problems };
      })
    );
  }

  function exportSets() {
    const payload = {
      exportedAt: new Date().toISOString(),
      version: 1,
      sets,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ps-tracker-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function triggerImport() {
    importInputRef.current?.click();
  }

  function handleImport(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();

    reader.onload = () => {
      try {
        const rawText = String(reader.result ?? "");
        const parsed = JSON.parse(rawText);
        const input = Array.isArray(parsed) ? parsed : parsed?.sets;
        const normalized = normalizeSets(input);
        if (normalized.length === 0) throw new Error("empty");

        setSets(normalized);
        setActiveSetId(normalized[0].id);
        alert("インポートが完了しました。");
      } catch {
        alert("インポートに失敗しました。JSON形式を確認してください。");
      } finally {
        e.target.value = "";
      }
    };

    reader.onerror = () => {
      alert("ファイル読み込みに失敗しました。");
      e.target.value = "";
    };

    reader.readAsText(file);
  }

  const chapters = active?.chapters ?? [];

  const filtered = useMemo(() => {
    if (!active) return [];
    let arr = active.problems;

    if (activeChapterId) arr = arr.filter((p) => p.chapterId === activeChapterId);
    if (filterStatus !== "all") arr = arr.filter((p) => p.status === filterStatus);

    const q = searchQuery.trim().toLowerCase();
    if (q) {
      arr = arr.filter((p) => {
        const title = p.title.toLowerCase();
        const notes = (p.notes ?? "").toLowerCase();
        const tags = Array.isArray(p.tags) ? p.tags.join(" ").toLowerCase() : "";
        return title.includes(q) || notes.includes(q) || tags.includes(q);
      });
    }

    switch (sortKey) {
      case "priority":
        arr = [...arr].sort((a, b) => priorityScore(a) - priorityScore(b));
        break;
      case "lastSeen":
        arr = [...arr].sort((a, b) => (a.lastSeenAt ?? 0) - (b.lastSeenAt ?? 0));
        break;
      case "wrongs":
        arr = [...arr].sort(
          (a, b) =>
            b.attempts.filter((x) => x.outcome === "x").length - a.attempts.filter((x) => x.outcome === "x").length
        );
        break;
      default:
        break;
    }

    return arr;
  }, [active, activeChapterId, filterStatus, searchQuery, sortKey]);

  const todayList = useMemo(() => {
    if (!active) return [];
    const pool = [...active.problems]
      .filter((p) => !activeChapterId || p.chapterId === activeChapterId)
      .sort((a, b) => priorityScore(a) - priorityScore(b));

    const pick = [];
    for (const p of pool) {
      if (p.status === "c") {
        if (pick.filter((q) => q.status === "c").length * 5 < pick.length + 1) pick.push(p);
      } else {
        pick.push(p);
      }
      if (pick.length >= dailyTarget) break;
    }
    return pick;
  }, [active, dailyTarget, activeChapterId]);

  const chapterStats = useMemo(() => {
    if (!active || !activeChapterId) return [];
    const ch = active.chapters.find((c) => c.id === activeChapterId);
    if (!ch) return [];
    const ps = active.problems.filter((p) => p.chapterId === ch.id);
    const done = ps.filter((p) => p.status === "c").length;
    const total = ps.length;
    return [{ ch, done, total, remaining: total - done }];
  }, [active, activeChapterId]);

  const statusCounts = useMemo(() => {
    if (!active) return { n: 0, x: 0, d: 0, c: 0 };
    const c = { n: 0, x: 0, d: 0, c: 0 };
    for (const p of active.problems) c[p.status] += 1;
    return c;
  }, [active]);

  if (!active) return <div className="p-4">データがありません。</div>;

  const progressRatio = active.problems.length === 0 ? 0 : Math.round((statusCounts.c / active.problems.length) * 100);

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-6">
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold">問題集トラッカー</h1>
          <span className="px-2 py-1 rounded bg-emerald-50 text-emerald-700 text-sm">完了率 {progressRatio}%</span>
          <div className="ml-auto flex gap-2">
            <button className="px-3 py-1 border rounded" onClick={undo} disabled={!canUndo}>Undo</button>
            <button className="px-3 py-1 border rounded" onClick={redo} disabled={!canRedo}>Redo</button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select className="border rounded px-2 py-1" value={activeSetId} onChange={(e) => setActiveSetId(e.target.value)}>
            {sets.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <select className="border rounded px-2 py-1" value={activeChapterId} onChange={(e) => setActiveChapterId(e.target.value)}>
            {active.chapters.map((ch) => (
              <option key={ch.id} value={ch.id}>{ch.name}</option>
            ))}
          </select>

          <details className="border rounded px-2 py-1">
            <summary className="cursor-pointer select-none">問題集の編集</summary>
            <div className="mt-2 flex flex-wrap gap-2">
              <button className="px-2 py-1 border rounded" onClick={addSet}>問題集を追加</button>
              <button className="px-2 py-1 border rounded" onClick={renameSet}>名前を変更</button>
              <button className="px-2 py-1 border rounded text-red-700" onClick={deleteSet}>問題集を削除</button>
            </div>
          </details>

          <details className="border rounded px-2 py-1">
            <summary className="cursor-pointer select-none">章の編集</summary>
            <div className="mt-2 flex flex-wrap gap-2">
              <button className="px-2 py-1 border rounded" onClick={addChapter}>章を追加</button>
              <button className="px-2 py-1 border rounded" onClick={renameChapter}>章名を変更</button>
              <button className="px-2 py-1 border rounded text-red-700" onClick={deleteChapter}>章を削除</button>
              <button className="px-2 py-1 border rounded" onClick={addProblem}>この章に問題を追加</button>
            </div>
          </details>

          <button className="px-2 py-1 border rounded" onClick={exportSets}>JSONエクスポート</button>
          <button className="px-2 py-1 border rounded" onClick={triggerImport}>JSONインポート</button>
          <input ref={importInputRef} type="file" accept="application/json,.json" className="hidden" onChange={handleImport} />
        </div>
      </header>

      <section className="grid md:grid-cols-2 gap-4">
        <div className="p-4 rounded-xl border">
          <h2 className="font-semibold mb-2">この章の進捗</h2>
          {chapterStats.length === 0 ? (
            <div className="text-sm text-gray-500">章がありません。章を追加してください。</div>
          ) : (
            <div className="space-y-3">
              {chapterStats.map(({ ch, done, total, remaining }) => (
                <div key={ch.id}>
                  <div className="flex justify-between text-sm mb-1">
                    <div>{ch.name}</div>
                    <div>{done}/{total} 完了（残り {remaining}）</div>
                  </div>
                  <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-600" style={{ width: `${(done / Math.max(total, 1)) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="p-4 rounded-xl border">
          <h2 className="font-semibold mb-2">状態内訳</h2>
          <div className="flex gap-4 items-end">
            {(["n", "x", "d", "c"]).map((k) => (
              <div key={k} className="flex-1">
                <div className="h-24 bg-gray-100 rounded flex items-end">
                  <div
                    className={`w-full ${statusColor[k]} rounded`}
                    style={{ height: `${Math.max(4, (statusCounts[k] / Math.max(active.problems.length, 1)) * 100)}%` }}
                  />
                </div>
                <div className="text-center mt-1 text-sm">{statusLabel[k]} {statusCounts[k]}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 text-sm text-gray-600">総数 {active.problems.length}</div>
        </div>
      </section>

      <section className="p-4 rounded-xl border">
        <div className="flex items-center gap-3 mb-3">
          <h2 className="font-semibold">今日やる（優先度ベース）</h2>
          <label className="text-sm">目標件数
            <input
              type="number"
              className="ml-2 border rounded px-2 py-1 w-20"
              value={dailyTarget}
              onChange={(e) => setDailyTarget(Math.max(0, parseInt(e.target.value || "0", 10)))}
            />
          </label>
        </div>

        {todayList.length === 0 ? (
          <div className="text-sm text-gray-500">今日やる候補がありません。問題を追加してください。</div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
            {todayList.map((p) => (
              <ProblemCard
                key={p.id}
                p={p}
                chapters={chapters}
                advanceProblemStatus={advanceProblemStatus}
                completeProblem={completeProblem}
                deleteProblem={deleteProblem}
                saveProblemNotes={saveProblemNotes}
                featured
              />
            ))}
          </div>
        )}
      </section>

      <section className="p-4 rounded-xl border space-y-3">
        <div className="sticky top-2 z-10 bg-white/95 backdrop-blur border rounded-lg p-3">
          <div className="flex flex-wrap gap-2 items-center">
            <h2 className="font-semibold mr-2">問題一覧</h2>
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="問題名・メモ・タグを検索"
              className="border rounded px-2 py-1 min-w-64"
            />
            <select className="border rounded px-2 py-1" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
              <option value="all">全状態</option>
              <option value="n">未</option>
              <option value="x">×</option>
              <option value="d">△</option>
              <option value="c">✔︎</option>
            </select>
            <select className="border rounded px-2 py-1" value={sortKey} onChange={(e) => setSortKey(e.target.value)}>
              <option value="priority">優先度</option>
              <option value="lastSeen">最終学習が古い順</option>
              <option value="wrongs">×が多い順</option>
            </select>
            <span className="text-sm text-gray-600 ml-auto">{filtered.length} 件</span>
          </div>
        </div>

        {active.problems.length === 0 ? (
          <div className="text-sm text-gray-500">この章には問題がありません。「この章に問題を追加」から追加できます。</div>
        ) : filtered.length === 0 ? (
          <div className="text-sm text-gray-500">条件に一致する問題がありません。</div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map((p) => (
              <ProblemCard
                key={p.id}
                p={p}
                chapters={chapters}
                advanceProblemStatus={advanceProblemStatus}
                completeProblem={completeProblem}
                deleteProblem={deleteProblem}
                saveProblemNotes={saveProblemNotes}
              />
            ))}
          </div>
        )}
      </section>

      <footer className="text-xs text-gray-500 pb-8">ローカル保存のみ。データはブラウザに保持されます。</footer>
    </div>
  );
}

function ProblemCard({ p, chapters, advanceProblemStatus, completeProblem, deleteProblem, saveProblemNotes, featured = false }) {
  const chapterName = chapters.find((c) => c.id === p.chapterId)?.name ?? "";
  const attemptsToCheck = p.attemptsToCheck;
  const last = p.lastSeenAt ? fmtDate(p.lastSeenAt) : "未学習";

  const [notesOpen, setNotesOpen] = useState(false);
  const [notes, setNotes] = useState(p.notes ?? "");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setNotes(p.notes ?? "");
    setDirty(false);
  }, [p.id, p.notes]);

  function handleSaveNotes() {
    saveProblemNotes(p.id, notes);
    setDirty(false);
  }

  return (
    <div className={`border rounded-xl p-3 space-y-2 ${featured ? "bg-emerald-50/40 border-emerald-200" : ""}`}>
      <div className="flex items-start gap-2">
        <div className={`w-2 h-2 mt-1 rounded-full ${
          p.status === "c" ? "bg-emerald-600" : p.status === "d" ? "bg-amber-500" : p.status === "x" ? "bg-red-500" : "bg-gray-400"
        }`} />

        <div className="flex-1 min-w-0">
          <div className="font-medium truncate">{p.title}</div>
          <div className="text-xs text-gray-500 truncate">{chapterName}</div>
        </div>

        <div className="text-right shrink-0">
          <div className={`text-xs font-medium ${statusText[p.status]}`}>{statusLabel[p.status]}</div>
          <div className="text-xs text-gray-500">最終 {last}</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={`px-2 py-0.5 rounded bg-gray-100 ${statusText[p.status]}`}>状態: {statusLabel[p.status]}</span>
        {typeof attemptsToCheck === "number" && <span className="px-2 py-0.5 rounded bg-gray-100 text-gray-700">完了まで: {attemptsToCheck}回</span>}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button className="px-2 py-1 text-sm border rounded" onClick={() => advanceProblemStatus(p.id, "x")}>× にする</button>
        <button className="px-2 py-1 text-sm border rounded" onClick={() => advanceProblemStatus(p.id, "d")}>△ にする</button>
        <button className="col-span-2 px-2 py-1 text-sm rounded bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => completeProblem(p.id)}>✔︎ 完了にする</button>
      </div>

      <div className="flex justify-end">
        <button
          className="px-2 py-1 text-xs border rounded text-red-700"
          onClick={() => {
            if (confirm(`「${p.title}」を削除します。よろしいですか？`)) deleteProblem(p.id);
          }}
        >
          削除
        </button>
      </div>

      <details className="text-sm">
        <summary className="cursor-pointer select-none">詳細・履歴</summary>
        <div className="mt-2 space-y-2">
          <div>
            <button className="px-2 py-1 text-xs border rounded" onClick={() => setNotesOpen(!notesOpen)}>
              {notesOpen ? "メモを閉じる" : "メモを開く"}
            </button>
            {notesOpen && (
              <div className="mt-2 space-y-2">
                <textarea
                  className="w-full h-24 border rounded p-2"
                  value={notes}
                  onChange={(e) => {
                    setNotes(e.target.value);
                    setDirty(true);
                  }}
                  onBlur={() => {
                    if (dirty) handleSaveNotes();
                  }}
                  placeholder="メモ・ヒント・参照リンクなど"
                />
                <div className="flex justify-end">
                  <button className="px-2 py-1 text-xs border rounded" onClick={handleSaveNotes} disabled={!dirty}>メモ保存</button>
                </div>
              </div>
            )}
          </div>

          <div>
            <div className="text-xs text-gray-600 mb-1">試行履歴</div>
            <div className="max-h-24 overflow-auto border rounded divide-y">
              {p.attempts.length === 0 ? (
                <div className="p-2 text-xs text-gray-500">まだ履歴がありません</div>
              ) : (
                p.attempts
                  .slice()
                  .reverse()
                  .map((a, i) => (
                    <div key={i} className="p-2 flex justify-between text-xs">
                      <div>
                        <span className={`${statusText[a.outcome]} font-medium`}>{statusLabel[a.outcome]}</span>
                        <span className="ml-2 text-gray-600">{fmtDate(a.at)}</span>
                      </div>
                      <div className="text-gray-500">#{p.attempts.length - i}</div>
                    </div>
                  ))
              )}
            </div>
          </div>
        </div>
      </details>
    </div>
  );
}
