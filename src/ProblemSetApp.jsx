import React, { useEffect, useMemo, useRef, useState } from "react";

const LS_KEY = "ps_tracker_v5";
const LEGACY_LS_KEY = "ps_tracker_v4";
const OLDEST_LS_KEY = "ps_tracker_v3";
const PREF_KEY = "ps_tracker_ui_prefs_v1";
const now = () => Date.now();
const fmtDate = (t) => new Date(t).toLocaleString();

const statusLabel = { n: "未", x: "×", d: "△", c: "✔" };
const statusColor = { n: "bg-gray-400", x: "bg-red-500", d: "bg-amber-500", c: "bg-emerald-600" };
const statusText = { n: "text-gray-600", x: "text-red-700", d: "text-amber-700", c: "text-emerald-700" };
const COUNT_DIRECT_VALUE = "__direct__";
const COUNT_EXPAND_VALUE = "__expand__";
const COUNT_EXPAND_STEP = 120;

function priorityScore(node) {
  const base = node.status === "c" ? 4 : 0;
  const days = node.lastSeenAt ? (now() - node.lastSeenAt) / (1000 * 60 * 60 * 24) : 999;
  const wrongs = node.attempts.filter((a) => a.outcome === "x").length;
  return base + (10 - Math.min(days, 10)) * -0.05 + wrongs * -0.1;
}

function createKind(prefix = "k") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function createNode(
  title,
  parentId = null,
  id = `n_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  kind = createKind()
) {
  return {
    id,
    kind,
    title,
    parentId,
    childrenIds: [],
    status: "n",
    tags: [],
    notes: "",
    attempts: [],
    firstCheckedAt: null,
    attemptsToCheck: null,
    lastSeenAt: null,
  };
}

function makeEmptySet(name = "新しい問題集") {
  return {
    id: `set_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name,
    rootIds: [],
    nodes: {},
  };
}

function normalizeNode(raw, idx, parentId = null) {
  const status = raw?.status;
  const safeStatus = status === "n" || status === "x" || status === "d" || status === "c" ? status : "n";
  const attempts = Array.isArray(raw?.attempts)
    ? raw.attempts
        .map((a) => ({ outcome: a?.outcome, at: Number(a?.at ?? Date.now()) }))
        .filter((a) => a.outcome === "n" || a.outcome === "x" || a.outcome === "d" || a.outcome === "c")
    : [];

  return {
    id: String(raw?.id ?? `n_${Date.now()}_${idx}`),
    kind: String(raw?.kind ?? ""),
    title: String(raw?.title ?? `項目${idx + 1}`),
    parentId,
    childrenIds: Array.isArray(raw?.childrenIds) ? raw.childrenIds.map((x) => String(x)) : [],
    status: safeStatus,
    tags: Array.isArray(raw?.tags) ? raw.tags.map((x) => String(x)) : [],
    notes: String(raw?.notes ?? ""),
    attempts,
    firstCheckedAt: raw?.firstCheckedAt == null ? null : Number(raw.firstCheckedAt),
    attemptsToCheck: raw?.attemptsToCheck == null ? null : Number(raw.attemptsToCheck),
    lastSeenAt: raw?.lastSeenAt == null ? null : Number(raw.lastSeenAt),
  };
}

function ensureNodeKinds(nodes, rootIds) {
  const visited = new Set();
  const stack = rootIds.map((id, index) => ({ id, parentKind: "root", slot: index + 1 }));

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || visited.has(current.id)) continue;
    const n = nodes[current.id];
    if (!n) continue;

    if (!n.kind) {
      n.kind = `${current.parentKind}_slot_${current.slot}`;
    }
    visited.add(current.id);

    n.childrenIds.forEach((cid, idx) => {
      stack.push({ id: cid, parentKind: n.kind, slot: idx + 1 });
    });
  }
}

function normalizeTreeSet(raw, setIdx) {
  const nodesRaw = raw?.nodes && typeof raw.nodes === "object" ? raw.nodes : {};
  const nodeIds = Object.keys(nodesRaw);
  const normalizedNodes = {};

  nodeIds.forEach((id, i) => {
    normalizedNodes[id] = normalizeNode({ ...nodesRaw[id], id }, i, nodesRaw[id]?.parentId ?? null);
  });

  let rootIds = Array.isArray(raw?.rootIds) ? raw.rootIds.map((x) => String(x)).filter((id) => normalizedNodes[id]) : [];

  if (rootIds.length === 0) {
    rootIds = nodeIds.filter((id) => !normalizedNodes[id]?.parentId);
  }

  if (rootIds.length === 0) {
    const id = `n_root_${Date.now()}_${setIdx}`;
    normalizedNodes[id] = createNode("第1階層", null, id);
    rootIds = [id];
  }

  Object.values(normalizedNodes).forEach((n) => {
    n.childrenIds = n.childrenIds.filter((cid) => normalizedNodes[cid]);
  });
  ensureNodeKinds(normalizedNodes, rootIds);

  return {
    id: String(raw?.id ?? `set_${Date.now()}_${setIdx}`),
    name: String(raw?.name ?? `問題集${setIdx + 1}`),
    rootIds,
    nodes: normalizedNodes,
  };
}

function convertLegacySet(raw, setIdx) {
  const chapters = Array.isArray(raw?.chapters) ? raw.chapters : [];
  const problems = Array.isArray(raw?.problems) ? raw.problems : [];
  const nodes = {};
  const rootIds = [];

  chapters.forEach((ch, i) => {
    const chId = `n_ch_${String(ch?.id ?? i)}`;
    const chNode = createNode(String(ch?.name ?? `第${i + 1}章`), null, chId, "kind_chapter");
    nodes[chId] = chNode;
    rootIds.push(chId);
  });

  const childSlotByParent = {};
  problems.forEach((p, i) => {
    const chapterRawId = String(p?.chapterId ?? "");
    const mappedParentId = rootIds.find((id) => id.endsWith(chapterRawId));
    const parentId = mappedParentId ?? rootIds[0] ?? null;
    const nodeId = String(p?.id ?? `n_legacy_${i}`);
    const slot = (childSlotByParent[parentId ?? "root"] ?? 0) + 1;
    childSlotByParent[parentId ?? "root"] = slot;
    const n = createNode(String(p?.title ?? `問${i + 1}`), parentId, nodeId, `kind_chapter_child_${slot}`);
    const normalized = normalizeNode({ ...n, ...p, id: nodeId, parentId }, i, parentId);
    nodes[nodeId] = normalized;

    if (parentId && nodes[parentId]) {
      nodes[parentId].childrenIds.push(nodeId);
    } else {
      rootIds.push(nodeId);
      normalized.parentId = null;
    }
  });

  if (rootIds.length === 0) {
    const id = `n_root_${Date.now()}_${setIdx}`;
    nodes[id] = createNode("第1階層", null, id);
    rootIds.push(id);
  }

  ensureNodeKinds(nodes, rootIds);

  return {
    id: String(raw?.id ?? `set_${Date.now()}_${setIdx}`),
    name: String(raw?.name ?? `問題集${setIdx + 1}`),
    rootIds,
    nodes,
  };
}

function normalizeSets(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return [makeEmptySet("問題集1")];

  return raw.map((set, idx) => {
    if (set?.nodes) return normalizeTreeSet(set, idx);
    if (set?.chapters || set?.problems) return convertLegacySet(set, idx);
    return normalizeTreeSet(set, idx);
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

  return { state, set, undo, redo };
}

function collectDescendants(set, startId) {
  const out = [];
  const stack = [startId];

  while (stack.length > 0) {
    const id = stack.pop();
    if (!id || out.includes(id)) continue;
    const node = set.nodes[id];
    if (!node) continue;
    out.push(id);
    node.childrenIds.forEach((cid) => stack.push(cid));
  }

  return out;
}

function buildPath(set, nodeId) {
  const names = [];
  let current = set.nodes[nodeId];
  let guard = 0;
  while (current && guard < 100) {
    names.unshift(current.title);
    current = current.parentId ? set.nodes[current.parentId] : null;
    guard += 1;
  }
  return names.join(" / ");
}

function buildPathIds(set, nodeId) {
  const ids = [];
  let current = set.nodes[nodeId];
  let guard = 0;
  while (current && guard < 100) {
    ids.unshift(current.id);
    current = current.parentId ? set.nodes[current.parentId] : null;
    guard += 1;
  }
  return ids;
}

function formatIndexedName(template, index) {
  if (!template) return `項目${index}`;
  if (template.includes("{n}")) return template.replaceAll("{n}", String(index));
  return `${template}${index}`;
}

function labelFromTemplate(template, fallback) {
  const cleaned = String(template ?? "")
    .replaceAll("{n}", "")
    .replace(/[\s:：._-]+$/g, "")
    .trim();
  return cleaned || fallback;
}

function createCountOptions(currentValue, upper = 120, start = 0) {
  const safe = Number.isFinite(Number(currentValue)) ? Number(currentValue) : 0;
  const safeUpper = Math.max(start, Number.isFinite(Number(upper)) ? Number(upper) : 120);
  const options = Array.from({ length: safeUpper - start + 1 }, (_, i) => i + start);
  if (safe > safeUpper) options.push(safe);
  return options;
}

function getCountForParent(countsByParent, parentPath) {
  const raw = Number(countsByParent[parentPath] ?? 0);
  if (parentPath === "root") return Math.max(1, Number.isFinite(raw) ? raw : 1);
  return Math.max(0, Number.isFinite(raw) ? raw : 0);
}

function getVirtualNodesByLevel(templates, countsByParent) {
  const levels = [[{ path: "root", label: "root", fullLabel: "全体", index: 1, parentPath: null }]];

  for (let lv = 0; lv < templates.length; lv += 1) {
    const parents = levels[lv];
    const tpl = templates[lv] ?? `第${lv + 1}階層{n}`;
    const next = [];
    for (const parent of parents) {
      const count = getCountForParent(countsByParent, parent.path);
      for (let i = 1; i <= count; i += 1) {
        const path = parent.path === "root" ? String(i) : `${parent.path}.${i}`;
        const label = formatIndexedName(tpl, i);
        const fullLabel = parent.path === "root" ? label : `${parent.fullLabel} / ${label}`;
        next.push({ path, label, fullLabel, index: i, parentPath: parent.path });
      }
    }
    levels.push(next);
  }

  return levels;
}

function buildCountsFromTree(set) {
  const counts = { root: Math.max(1, set?.rootIds?.length ?? 1) };
  let maxDepth = 1;
  if (!set) return { counts, maxDepth };

  function walk(nodeId, path) {
    const node = set.nodes[nodeId];
    if (!node) return;
    const depth = path.split(".").length;
    if (depth > maxDepth) maxDepth = depth;
    counts[path] = node.childrenIds.length;
    node.childrenIds.forEach((childId, idx) => {
      walk(childId, `${path}.${idx + 1}`);
    });
  }

  set.rootIds.forEach((rootId, idx) => {
    walk(rootId, String(idx + 1));
  });

  return { counts, maxDepth: Math.max(1, maxDepth) };
}

function deleteNodeDeep(set, nodeId) {
  const targets = new Set(collectDescendants(set, nodeId));
  const nodes = { ...set.nodes };
  targets.forEach((id) => {
    delete nodes[id];
  });

  const current = set.nodes[nodeId];
  const parentId = current?.parentId ?? null;
  let rootIds = [...set.rootIds];

  if (parentId && nodes[parentId]) {
    nodes[parentId] = {
      ...nodes[parentId],
      childrenIds: nodes[parentId].childrenIds.filter((cid) => !targets.has(cid)),
    };
  } else {
    rootIds = rootIds.filter((id) => !targets.has(id));
  }

  Object.values(nodes).forEach((n) => {
    n.childrenIds = n.childrenIds.filter((cid) => nodes[cid]);
  });

  return { nextSet: { ...set, nodes, rootIds }, parentId };
}

export default function ProblemSetApp() {
  const persisted = useMemo(() => {
    try {
      const raw = localStorage.getItem(LS_KEY) ?? localStorage.getItem(LEGACY_LS_KEY) ?? localStorage.getItem(OLDEST_LS_KEY);
      if (!raw) return [makeEmptySet("問題集1")];
      return normalizeSets(JSON.parse(raw));
    } catch {
      return [makeEmptySet("問題集1")];
    }
  }, []);

  const { state: sets, set: setSets, undo, redo } = useHistoryState(persisted);
  const [activeSetId, setActiveSetId] = useState(sets[0]?.id ?? "");

  useEffect(() => {
    localStorage.setItem(LS_KEY, JSON.stringify(sets));
  }, [sets]);

  const active = useMemo(() => sets.find((s) => s.id === activeSetId) ?? sets[0], [sets, activeSetId]);

  const firstRootId = active?.rootIds?.[0] ?? "";
  const [activeNodeId, setActiveNodeId] = useState(firstRootId);
  useEffect(() => {
    setActiveNodeId(firstRootId);
  }, [active?.id, firstRootId]);

  const [filterStatus, setFilterStatus] = useState("all");
  const [sortKey, setSortKey] = useState("priority");
  const [searchQuery, setSearchQuery] = useState("");
  const [dailyTarget, setDailyTarget] = useState(20);
  const [collapsedNodeIds, setCollapsedNodeIds] = useState({});
  const importInputRef = useRef(null);
  const [levelTemplates, setLevelTemplates] = useState(["第{n}章", "第2階層{n}", "第3階層{n}"]);
  const [builderCountsByParent, setBuilderCountsByParent] = useState({ root: 1 });
  const [countOptionUpper, setCountOptionUpper] = useState(120);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PREF_KEY);
      if (!raw) return;
      const pref = JSON.parse(raw);
      if (pref?.filterStatus) setFilterStatus(pref.filterStatus);
      if (pref?.sortKey) setSortKey(pref.sortKey);
      if (typeof pref?.dailyTarget === "number") setDailyTarget(pref.dailyTarget);
    } catch {
      // ignore invalid UI preference payload
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(
      PREF_KEY,
      JSON.stringify({
        filterStatus,
        sortKey,
        dailyTarget,
      })
    );
  }, [filterStatus, sortKey, dailyTarget]);

  useEffect(() => {
    setCollapsedNodeIds({});
  }, [active?.id]);

  useEffect(() => {
    if (!active) return;
    const { counts, maxDepth } = buildCountsFromTree(active);
    const maxCount = Math.max(1, ...Object.values(counts).map((v) => Math.max(0, Number(v) || 0)));
    setBuilderCountsByParent(counts);
    setCountOptionUpper((prev) => Math.max(prev, Math.min(maxCount + 20, prev + COUNT_EXPAND_STEP)));
    setLevelTemplates((prev) => {
      const next = [...prev];
      while (next.length < maxDepth) next.push(`第${next.length + 1}階層{n}`);
      return next;
    });
  }, [active]);

  function mutateActiveSet(mutator) {
    if (!active) return;
    setSets((prev) => prev.map((s) => (s.id === active.id ? mutator(s) : s)));
  }

  function setCountForParent(parentPath, count) {
    setBuilderCountsByParent((prev) => {
      const min = parentPath === "root" ? 1 : 0;
      const nextValue = Math.max(min, Number(count) || 0);
      const prevValue = getCountForParent(prev, parentPath);
      const next = { ...prev, [parentPath]: nextValue };
      if (nextValue < prevValue) {
        for (let i = nextValue + 1; i <= prevValue; i += 1) {
          const droppedPath = parentPath === "root" ? String(i) : `${parentPath}.${i}`;
          Object.keys(next).forEach((k) => {
            if (k === droppedPath || k.startsWith(`${droppedPath}.`)) delete next[k];
          });
        }
      }
      return next;
    });
  }

  function applyCountToAllParents(parents, count) {
    const value = Math.max(0, Number(count) || 0);
    setBuilderCountsByParent((prev) => {
      const next = { ...prev };
      parents.forEach((p) => {
        const min = p.path === "root" ? 1 : 0;
        next[p.path] = Math.max(min, value);
      });
      return next;
    });
  }

  function expandCountOptions() {
    setCountOptionUpper((prev) => prev + COUNT_EXPAND_STEP);
  }

  function ensureCountOptionUpper(value) {
    const safe = Math.max(0, Number(value) || 0);
    setCountOptionUpper((prev) => Math.max(prev, Math.min(safe + 20, prev + COUNT_EXPAND_STEP)));
  }

  function promptCountValue(label, currentValue, minValue) {
    const raw = prompt(`${label}を入力してください`, String(Math.max(minValue, currentValue)));
    if (raw == null) return null;
    const parsed = parseInt(raw, 10);
    if (!Number.isFinite(parsed)) {
      alert("整数で入力してください。");
      return null;
    }
    return Math.max(minValue, parsed);
  }

  function addHierarchyLevel() {
    setLevelTemplates((prev) => [...prev, `第${prev.length + 1}階層{n}`]);
  }

  function removeHierarchyLevel() {
    setLevelTemplates((prev) => {
      if (prev.length <= 1) return prev;
      const nextLength = prev.length - 1;
      setBuilderCountsByParent((countsPrev) => {
        const nextCounts = { ...countsPrev };
        Object.keys(nextCounts).forEach((k) => {
          if (k === "root") return;
          const depth = k.split(".").length;
          if (depth >= nextLength) delete nextCounts[k];
        });
        return nextCounts;
      });
      return prev.slice(0, -1);
    });
  }

  function rebuildTreeFromBuilder() {
    if (!active) return;
    if (!confirm("現在の階層構造を置き換えます。よろしいですか？")) return;

    const nodes = {};
    const rootIds = [];
    const levels = Math.max(1, levelTemplates.length);

    function build(parentPath, parentId, levelIndex) {
      if (levelIndex >= levels) return;
      const tpl = levelTemplates[levelIndex] ?? `第${levelIndex + 1}階層{n}`;
      const count = getCountForParent(builderCountsByParent, parentPath);
      for (let i = 1; i <= count; i += 1) {
        const path = parentPath === "root" ? String(i) : `${parentPath}.${i}`;
        const node = createNode(
          formatIndexedName(tpl, i),
          parentId,
          undefined,
          `kind_l${levelIndex + 1}_${path.replace(/\./g, "_")}`
        );
        nodes[node.id] = node;
        if (parentId) {
          const p = nodes[parentId];
          nodes[parentId] = { ...p, childrenIds: [...p.childrenIds, node.id] };
        } else {
          rootIds.push(node.id);
        }
        build(path, node.id, levelIndex + 1);
      }
    }

    build("root", null, 0);

    mutateActiveSet((s) => ({ ...s, nodes, rootIds }));
    setActiveNodeId(rootIds[0] ?? "");
  }

  function resetBuilder() {
    setLevelTemplates(["第{n}章", "第2階層{n}", "第3階層{n}"]);
    setBuilderCountsByParent({ root: 1 });
  }

  function addSet() {
    const name = prompt("新しい問題集の名前");
    if (!name) return;
    const ns = makeEmptySet(name);
    setSets([...sets, ns]);
    setActiveSetId(ns.id);
  }

  function renameSet() {
    if (!active) return;
    const name = prompt("問題集名を編集", active.name);
    if (!name) return;
    mutateActiveSet((s) => ({ ...s, name }));
  }

  function deleteSet() {
    if (!active) return;
    if (!confirm(`問題集「${active.name}」を削除します。よろしいですか？`)) return;
    const next = sets.filter((s) => s.id !== active.id);
    if (next.length === 0) {
      const empty = makeEmptySet("問題集1");
      setSets([empty]);
      setActiveSetId(empty.id);
      return;
    }
    setSets(next);
    setActiveSetId(next[0].id);
  }

  function renameNode() {
    if (!active || !activeNodeId) return;
    const node = active.nodes[activeNodeId];
    if (!node) return;
    const title = prompt("項目名を編集", node.title);
    if (!title) return;

    mutateActiveSet((s) => ({
      ...s,
      nodes: { ...s.nodes, [node.id]: { ...s.nodes[node.id], title } },
    }));
  }

  function deleteNode() {
    if (!active || !activeNodeId) return;
    const target = active.nodes[activeNodeId];
    if (!target) return;
    if (!confirm(`「${target.title}」と配下の全項目を削除します。よろしいですか？`)) return;

    const { nextSet, parentId } = deleteNodeDeep(active, activeNodeId);
    const finalSet =
      nextSet.rootIds.length > 0
        ? nextSet
        : (() => {
            const fallback = createNode("第1階層", null);
            return {
              ...nextSet,
              rootIds: [fallback.id],
              nodes: { ...nextSet.nodes, [fallback.id]: fallback },
            };
          })();

    mutateActiveSet(() => finalSet);
    setActiveNodeId(parentId ?? finalSet.rootIds[0] ?? "");
  }

  function saveNodeNotes(nodeId, notes) {
    if (!active) return;
    mutateActiveSet((s) => ({
      ...s,
      nodes: { ...s.nodes, [nodeId]: { ...s.nodes[nodeId], notes } },
    }));
  }

  function advanceNodeStatus(nodeId, target) {
    if (!active) return;
    mutateActiveSet((s) => {
      const n = s.nodes[nodeId];
      if (!n) return s;
      const at = now();
      return {
        ...s,
        nodes: {
          ...s.nodes,
          [nodeId]: {
            ...n,
            status: target,
            attempts: [...n.attempts, { outcome: target, at }],
            lastSeenAt: at,
          },
        },
      };
    });
  }

  function completeNode(nodeId) {
    if (!active) return;
    mutateActiveSet((s) => {
      const n = s.nodes[nodeId];
      if (!n) return s;
      const at = now();
      const becameCheck = n.status !== "c";
      const attempts = [...n.attempts, { outcome: "c", at }];
      return {
        ...s,
        nodes: {
          ...s.nodes,
          [nodeId]: {
            ...n,
            status: "c",
            attempts,
            lastSeenAt: at,
            attemptsToCheck: becameCheck && n.attemptsToCheck == null ? attempts.length : n.attemptsToCheck,
            firstCheckedAt: becameCheck && !n.firstCheckedAt ? at : n.firstCheckedAt,
          },
        },
      };
    });
  }

  function bulkSetStatusForFiltered(targetStatus) {
    if (!active || filtered.length === 0) return;
    const count = filtered.length;
    const label = statusLabel[targetStatus] ?? targetStatus;
    if (!confirm(`一覧の${count}件を「${label}」に変更します。よろしいですか？`)) return;

    const targetIds = new Set(filtered.map((n) => n.id));
    mutateActiveSet((s) => {
      const nextNodes = { ...s.nodes };
      for (const id of targetIds) {
        const n = nextNodes[id];
        if (!n) continue;
        const at = now();
        const attempts = [...n.attempts, { outcome: targetStatus, at }];
        if (targetStatus === "c") {
          const becameCheck = n.status !== "c";
          nextNodes[id] = {
            ...n,
            status: "c",
            attempts,
            lastSeenAt: at,
            attemptsToCheck: becameCheck && n.attemptsToCheck == null ? attempts.length : n.attemptsToCheck,
            firstCheckedAt: becameCheck && !n.firstCheckedAt ? at : n.firstCheckedAt,
          };
        } else {
          nextNodes[id] = {
            ...n,
            status: targetStatus,
            attempts,
            lastSeenAt: at,
          };
        }
      }
      return { ...s, nodes: nextNodes };
    });
  }

  function exportSets() {
    const payload = {
      exportedAt: new Date().toISOString(),
      version: 2,
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
        const source = Array.isArray(parsed) ? parsed : parsed?.sets;
        const normalized = normalizeSets(source);
        setSets(normalized);
        setActiveSetId(normalized[0]?.id ?? "");
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

  const scopedNodeIds = useMemo(() => {
    if (!active) return [];
    if (!activeNodeId) return active.rootIds.flatMap((id) => collectDescendants(active, id));
    return collectDescendants(active, activeNodeId);
  }, [active, activeNodeId]);

  const scopedNodes = useMemo(() => {
    if (!active) return [];
    return scopedNodeIds.map((id) => active.nodes[id]).filter(Boolean);
  }, [active, scopedNodeIds]);

  const filtered = useMemo(() => {
    let arr = [...scopedNodes];

    if (filterStatus !== "all") arr = arr.filter((n) => n.status === filterStatus);

    const q = searchQuery.trim().toLowerCase();
    if (q) {
      arr = arr.filter((n) => {
        const title = n.title.toLowerCase();
        const notes = (n.notes ?? "").toLowerCase();
        const tags = Array.isArray(n.tags) ? n.tags.join(" ").toLowerCase() : "";
        const path = active ? buildPath(active, n.id).toLowerCase() : "";
        return title.includes(q) || notes.includes(q) || tags.includes(q) || path.includes(q);
      });
    }

    switch (sortKey) {
      case "priority":
        arr.sort((a, b) => priorityScore(a) - priorityScore(b));
        break;
      case "lastSeen":
        arr.sort((a, b) => (a.lastSeenAt ?? 0) - (b.lastSeenAt ?? 0));
        break;
      case "wrongs":
        arr.sort(
          (a, b) =>
            b.attempts.filter((x) => x.outcome === "x").length - a.attempts.filter((x) => x.outcome === "x").length
        );
        break;
      default:
        break;
    }

    return arr;
  }, [active, filterStatus, scopedNodes, searchQuery, sortKey]);

  const todayList = useMemo(() => {
    const pool = [...scopedNodes].sort((a, b) => priorityScore(a) - priorityScore(b));
    const pick = [];

    for (const n of pool) {
      if (n.status === "c") {
        if (pick.filter((q) => q.status === "c").length * 5 < pick.length + 1) pick.push(n);
      } else {
        pick.push(n);
      }
      if (pick.length >= dailyTarget) break;
    }

    return pick;
  }, [scopedNodes, dailyTarget]);

  const statusCounts = useMemo(() => {
    const c = { n: 0, x: 0, d: 0, c: 0 };
    scopedNodes.forEach((n) => {
      c[n.status] += 1;
    });
    return c;
  }, [scopedNodes]);

  const levelLabels = levelTemplates.map((tpl, idx) => labelFromTemplate(tpl, `第${idx + 1}階層`));
  const virtualLevels = useMemo(
    () => getVirtualNodesByLevel(levelTemplates, builderCountsByParent),
    [levelTemplates, builderCountsByParent]
  );
  const levelNodeCounts = levelTemplates.map((_, idx) => virtualLevels[idx + 1]?.length ?? 0);

  if (!active) return <div className="p-4">データがありません。</div>;

  const progressRatio = scopedNodes.length === 0 ? 0 : Math.round((statusCounts.c / scopedNodes.length) * 100);
  const activeNodeTitle = activeNodeId ? active.nodes[activeNodeId]?.title ?? "" : "全体";
  const breadcrumbIds = activeNodeId ? buildPathIds(active, activeNodeId) : [];
  const collapsibleNodeIds = Object.keys(active.nodes).filter((id) => active.nodes[id].childrenIds.length > 0);

  return (
    <div className="app-shell">
      <header className="panel-strong space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="title-accent">問題集トラッカー</h1>
          <span className="chip text-emerald-800">完了率 {progressRatio}%</span>
          <span className="chip text-slate-700">フォーカス: {activeNodeTitle || "全体"}</span>
          <div className="ml-auto flex gap-2">
            <button className="btn" onClick={undo}>Undo</button>
            <button className="btn" onClick={redo}>Redo</button>
          </div>
        </div>

        {breadcrumbIds.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 text-xs text-gray-600">
            <span className="mr-1">現在地:</span>
            {breadcrumbIds.map((id, idx) => (
              <button
                key={id}
                type="button"
                className="chip hover:bg-emerald-50"
                onClick={() => setActiveNodeId(id)}
              >
                {active.nodes[id]?.title ?? id}
                {idx < breadcrumbIds.length - 1 ? " /" : ""}
              </button>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <select className="control" value={activeSetId} onChange={(e) => setActiveSetId(e.target.value)}>
            {sets.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>

          <details className="control">
            <summary className="cursor-pointer select-none">問題集の編集</summary>
            <div className="mt-2 flex flex-wrap gap-2">
              <button className="btn" onClick={addSet}>問題集を追加</button>
              <button className="btn" onClick={renameSet}>名前を変更</button>
              <button className="btn btn-danger" onClick={deleteSet}>問題集を削除</button>
            </div>
          </details>

          <button className="btn" onClick={exportSets}>JSONエクスポート</button>
          <button className="btn" onClick={triggerImport}>JSONインポート</button>
          <input ref={importInputRef} type="file" accept="application/json,.json" className="hidden" onChange={handleImport} />
        </div>

        <details className="panel planner-shell">
          <summary className="planner-summary cursor-pointer select-none font-semibold">構造・数量設定（1ページ）</summary>
          <div className="mt-3 space-y-4">
            <div className="planner-meta flex flex-wrap gap-2">
              {levelLabels.map((label, idx) => (
                <span key={`lv-count-${idx + 1}`} className="chip">{label}数: {levelNodeCounts[idx] ?? 0}</span>
              ))}
            </div>

            <div className="planner-actions flex flex-wrap items-center gap-2">
              <button className="btn" onClick={addHierarchyLevel}>階層を追加</button>
              <button className="btn" onClick={removeHierarchyLevel} disabled={levelTemplates.length <= 1}>最下層を削除</button>
            </div>

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
              {levelTemplates.map((tpl, idx) => (
                <label key={`template-${idx}`} className="planner-input text-sm">第{idx + 1}階層名
                  <input
                    className="control w-full mt-1"
                    value={tpl}
                    onChange={(e) => setLevelTemplates((prev) => prev.map((x, i) => (i === idx ? e.target.value : x)))}
                    placeholder={`第${idx + 1}階層{n}`}
                  />
                </label>
              ))}
            </div>

            {Array.from({ length: levelTemplates.length }, (_, levelIdx) => {
              const parents = virtualLevels[levelIdx] ?? [];
              const parentLabel = levelIdx === 0 ? "全体" : (levelLabels[levelIdx - 1] ?? `第${levelIdx}階層`);
              const childLabel = levelLabels[levelIdx] ?? `第${levelIdx + 1}階層`;
              const minValue = levelIdx === 0 ? 1 : 0;
              return (
                <section key={`count-level-${levelIdx}`} className="planner-block space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold text-sm">{parentLabel}ごとの{childLabel}数</h3>
                    <label className="text-xs ml-auto">
                      一括適用
                      <select
                        className="control ml-2"
                        defaultValue=""
                        onChange={(e) => {
                          const raw = e.target.value;
                          if (!raw) return;
                          if (raw === COUNT_EXPAND_VALUE) {
                            expandCountOptions();
                            e.target.value = "";
                            return;
                          }
                          if (raw === COUNT_DIRECT_VALUE) {
                            const direct = promptCountValue(`${childLabel}数`, minValue, minValue);
                            if (direct != null) {
                              ensureCountOptionUpper(direct);
                              applyCountToAllParents(parents, direct);
                            }
                            e.target.value = "";
                            return;
                          }
                          applyCountToAllParents(parents, parseInt(raw, 10));
                          e.target.value = "";
                        }}
                      >
                        <option value="">選択</option>
                        {createCountOptions(0, countOptionUpper, minValue).map((n) => (
                          <option key={`bulk-level-${levelIdx}-${n}`} value={n}>{n}</option>
                        ))}
                        <option value={COUNT_EXPAND_VALUE}>+{COUNT_EXPAND_STEP}件を表示</option>
                        <option value={COUNT_DIRECT_VALUE}>数値を直接入力…</option>
                      </select>
                    </label>
                  </div>

                  {parents.length === 0 ? (
                    <div className="text-xs text-gray-500">上位階層の項目数を設定するとここに表示されます。</div>
                  ) : (
                    <div className="grid md:grid-cols-2 gap-2">
                      {parents.map((p) => {
                        const current = getCountForParent(builderCountsByParent, p.path);
                        return (
                          <label key={`count-${levelIdx}-${p.path}`} className="text-sm">
                            {p.path === "root" ? "全体" : p.fullLabel}
                            <select
                              className="control ml-2"
                              value={current}
                              onChange={(e) => {
                                const raw = e.target.value;
                                if (raw === COUNT_EXPAND_VALUE) {
                                  expandCountOptions();
                                  return;
                                }
                                if (raw === COUNT_DIRECT_VALUE) {
                                  const direct = promptCountValue(`${p.fullLabel} の${childLabel}数`, current, minValue);
                                  if (direct != null) {
                                    ensureCountOptionUpper(direct);
                                    setCountForParent(p.path, direct);
                                  }
                                  return;
                                }
                                setCountForParent(p.path, parseInt(raw, 10));
                              }}
                            >
                              {createCountOptions(current, countOptionUpper, minValue).map((n) => (
                                <option key={`opt-${levelIdx}-${p.path}-${n}`} value={n}>{n}</option>
                              ))}
                              <option value={COUNT_EXPAND_VALUE}>+{COUNT_EXPAND_STEP}件を表示</option>
                              <option value={COUNT_DIRECT_VALUE}>数値を直接入力…</option>
                            </select>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </section>
              );
            })}

            <div className="flex flex-wrap gap-2">
              <button className="btn btn-primary" onClick={rebuildTreeFromBuilder}>この設定で階層を再生成</button>
              <button className="btn" onClick={resetBuilder}>設定を初期化</button>
              <button className="btn" onClick={renameNode} disabled={!activeNodeId}>選択項目名を変更</button>
              <button className="btn btn-danger" onClick={deleteNode} disabled={!activeNodeId}>選択項目を削除</button>
            </div>
          </div>
        </details>
      </header>

      <section className="grid md:grid-cols-3 gap-4">
        <div className="panel md:col-span-1">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold">階層ツリー</h2>
            <div className="flex items-center gap-2">
              <button className="btn text-xs px-2 py-1" onClick={() => setActiveNodeId("")}>全体表示</button>
              <button
                className="btn text-xs px-2 py-1"
                onClick={() => {
                  const next = {};
                  collapsibleNodeIds.forEach((id) => {
                    next[id] = false;
                  });
                  setCollapsedNodeIds(next);
                }}
              >
                全展開
              </button>
              <button
                className="btn text-xs px-2 py-1"
                onClick={() => {
                  const next = {};
                  collapsibleNodeIds.forEach((id) => {
                    next[id] = true;
                  });
                  setCollapsedNodeIds(next);
                }}
              >
                全折りたたみ
              </button>
            </div>
          </div>
          {active.rootIds.length === 0 ? (
            <div className="text-sm text-gray-500">項目がありません。</div>
          ) : (
            <div className="space-y-1 max-h-80 overflow-auto pr-1">
              {active.rootIds.map((id) => (
                <TreeItem
                  key={id}
                  set={active}
                  nodeId={id}
                  depth={0}
                  activeNodeId={activeNodeId}
                  onSelect={setActiveNodeId}
                  collapsedNodeIds={collapsedNodeIds}
                  onToggleCollapse={(nodeId) => {
                    setCollapsedNodeIds((prev) => ({ ...prev, [nodeId]: !prev[nodeId] }));
                  }}
                />
              ))}
            </div>
          )}
        </div>

        <div className="panel md:col-span-2">
          <h2 className="font-semibold mb-2">状態内訳（フォーカス範囲）</h2>
          <div className="flex gap-4 items-end">
            {(["n", "x", "d", "c"]).map((k) => (
              <div key={k} className="flex-1">
                <div className="h-24 bg-gray-100 rounded flex items-end">
                  <div
                    className={`w-full ${statusColor[k]} rounded`}
                    style={{ height: `${Math.max(4, (statusCounts[k] / Math.max(scopedNodes.length, 1)) * 100)}%` }}
                  />
                </div>
                <div className="text-center mt-1 text-sm">{statusLabel[k]} {statusCounts[k]}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 text-sm text-gray-600">対象件数 {scopedNodes.length}</div>
        </div>
      </section>

      <section className="panel">
        <div className="flex items-center gap-3 mb-3">
          <h2 className="font-semibold">今日やる（優先度ベース）</h2>
          <label className="text-sm">目標件数
            <input
              type="number"
              className="control ml-2 w-20"
              value={dailyTarget}
              onChange={(e) => setDailyTarget(Math.max(0, parseInt(e.target.value || "0", 10)))}
            />
          </label>
        </div>

        {todayList.length === 0 ? (
          <div className="text-sm text-gray-500">候補がありません。項目を追加してください。</div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
            {todayList.map((n) => (
              <NodeCard
                key={n.id}
                node={n}
                path={buildPath(active, n.id)}
                onAdvance={advanceNodeStatus}
                onComplete={completeNode}
                onDelete={(nodeId) => {
                  setActiveNodeId(nodeId);
                  setTimeout(deleteNode, 0);
                }}
                onSaveNotes={saveNodeNotes}
                onSelect={setActiveNodeId}
                featured
              />
            ))}
          </div>
        )}
      </section>

      <section className="panel space-y-3">
        <div className="toolbar-sticky">
          <div className="flex flex-wrap gap-2 items-center">
            <h2 className="font-semibold mr-2">項目一覧</h2>
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="項目名・パス・メモ・タグを検索"
              className="control min-w-64"
            />
            <select className="control" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
              <option value="all">全状態</option>
              <option value="n">未</option>
              <option value="x">×</option>
              <option value="d">△</option>
              <option value="c">✔</option>
            </select>
            <select className="control" value={sortKey} onChange={(e) => setSortKey(e.target.value)}>
              <option value="priority">優先度</option>
              <option value="lastSeen">最終学習が古い順</option>
              <option value="wrongs">×が多い順</option>
            </select>
            <span className="text-sm text-gray-600 ml-auto">{filtered.length} 件</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-xs text-gray-500">一覧一括:</span>
            <button className="btn text-xs px-2 py-1" onClick={() => bulkSetStatusForFiltered("x")} disabled={filtered.length === 0}>×</button>
            <button className="btn text-xs px-2 py-1" onClick={() => bulkSetStatusForFiltered("d")} disabled={filtered.length === 0}>△</button>
            <button className="btn text-xs px-2 py-1" onClick={() => bulkSetStatusForFiltered("c")} disabled={filtered.length === 0}>✔</button>
          </div>
        </div>

        {scopedNodes.length === 0 ? (
          <div className="text-sm text-gray-500">この範囲には項目がありません。</div>
        ) : filtered.length === 0 ? (
          <div className="text-sm text-gray-500">条件に一致する項目がありません。</div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map((n) => (
              <NodeCard
                key={n.id}
                node={n}
                path={buildPath(active, n.id)}
                onAdvance={advanceNodeStatus}
                onComplete={completeNode}
                onDelete={(nodeId) => {
                  setActiveNodeId(nodeId);
                  setTimeout(deleteNode, 0);
                }}
                onSaveNotes={saveNodeNotes}
                onSelect={setActiveNodeId}
              />
            ))}
          </div>
        )}
      </section>

      <footer className="text-xs text-gray-500 pb-8">ローカル保存のみ。データはブラウザに保持されます。</footer>
    </div>
  );
}

function TreeItem({ set, nodeId, depth, activeNodeId, onSelect, collapsedNodeIds, onToggleCollapse }) {
  const node = set.nodes[nodeId];
  if (!node) return null;
  const hasChildren = node.childrenIds.length > 0;
  const isCollapsed = !!collapsedNodeIds[nodeId];

  return (
    <div>
      <div className={`tree-row ${activeNodeId === nodeId ? "tree-row-active" : ""}`} style={{ paddingLeft: `${depth * 14 + 8}px` }}>
        <button
          type="button"
          className={`w-5 h-5 rounded text-xs flex items-center justify-center ${hasChildren ? "hover:bg-gray-200/70" : "opacity-30 cursor-default"}`}
          onClick={() => {
            if (hasChildren) onToggleCollapse(nodeId);
          }}
          aria-label={hasChildren ? (isCollapsed ? "展開" : "折りたたみ") : "子なし"}
        >
          {hasChildren ? (isCollapsed ? "▶" : "▼") : "•"}
        </button>
        <button type="button" className="flex items-center gap-2 flex-1 text-left min-w-0" onClick={() => onSelect(nodeId)}>
          <span className={`inline-block w-2 h-2 rounded-full ${
            node.status === "c" ? "bg-emerald-600" : node.status === "d" ? "bg-amber-500" : node.status === "x" ? "bg-red-500" : "bg-gray-400"
          }`} />
          <span className="truncate">{node.title}</span>
          <span className="text-xs text-gray-500 ml-auto">{node.childrenIds.length}</span>
        </button>
      </div>
      {!isCollapsed && node.childrenIds.map((cid) => (
        <TreeItem
          key={cid}
          set={set}
          nodeId={cid}
          depth={depth + 1}
          activeNodeId={activeNodeId}
          onSelect={onSelect}
          collapsedNodeIds={collapsedNodeIds}
          onToggleCollapse={onToggleCollapse}
        />
      ))}
    </div>
  );
}

function NodeCard({ node, path, onAdvance, onComplete, onDelete, onSaveNotes, onSelect, featured = false }) {
  const attemptsToCheck = node.attemptsToCheck;
  const last = node.lastSeenAt ? fmtDate(node.lastSeenAt) : "未学習";

  const [notesOpen, setNotesOpen] = useState(false);
  const [notes, setNotes] = useState(node.notes ?? "");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setNotes(node.notes ?? "");
    setDirty(false);
  }, [node.id, node.notes]);

  function handleSaveNotes() {
    onSaveNotes(node.id, notes);
    setDirty(false);
  }

  return (
    <div className={`panel space-y-2 ${featured ? "ring-1 ring-emerald-200 shadow-md" : ""}`}>
      <div className="flex items-start gap-2">
        <div className={`w-2 h-2 mt-1 rounded-full ${
          node.status === "c" ? "bg-emerald-600" : node.status === "d" ? "bg-amber-500" : node.status === "x" ? "bg-red-500" : "bg-gray-400"
        }`} />

        <div className="flex-1 min-w-0">
          <button className="font-medium truncate text-left hover:underline" onClick={() => onSelect(node.id)}>{node.title}</button>
          <div className="text-xs text-gray-500 truncate">{path}</div>
        </div>

        <div className="text-right shrink-0">
          <div className={`text-xs font-medium ${statusText[node.status]}`}>{statusLabel[node.status]}</div>
          <div className="text-xs text-gray-500">最終 {last}</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={`chip ${statusText[node.status]}`}>状態: {statusLabel[node.status]}</span>
        {typeof attemptsToCheck === "number" && <span className="chip text-gray-700">完了まで: {attemptsToCheck}回</span>}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button className="btn" onClick={() => onAdvance(node.id, "x")}>× にする</button>
        <button className="btn" onClick={() => onAdvance(node.id, "d")}>△ にする</button>
        <button className="btn btn-primary col-span-2" onClick={() => onComplete(node.id)}>✔ 完了にする</button>
      </div>

      <div className="flex justify-end">
        <button className="btn btn-danger text-xs px-2 py-1" onClick={() => onDelete(node.id)}>削除</button>
      </div>

      <details className="text-sm">
        <summary className="cursor-pointer select-none">詳細・履歴</summary>
        <div className="mt-2 space-y-2">
          <div>
            <button className="btn text-xs px-2 py-1" onClick={() => setNotesOpen(!notesOpen)}>
              {notesOpen ? "メモを閉じる" : "メモを開く"}
            </button>
            {notesOpen && (
              <div className="mt-2 space-y-2">
                <textarea
                  className="control w-full h-24 p-2"
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
                  <button className="btn text-xs px-2 py-1" onClick={handleSaveNotes} disabled={!dirty}>メモ保存</button>
                </div>
              </div>
            )}
          </div>

          <div>
            <div className="text-xs text-gray-600 mb-1">試行履歴</div>
            <div className="max-h-24 overflow-auto border rounded divide-y">
              {node.attempts.length === 0 ? (
                <div className="p-2 text-xs text-gray-500">まだ履歴がありません</div>
              ) : (
                node.attempts
                  .slice()
                  .reverse()
                  .map((a, i) => (
                    <div key={i} className="p-2 flex justify-between text-xs">
                      <div>
                        <span className={`${statusText[a.outcome]} font-medium`}>{statusLabel[a.outcome]}</span>
                        <span className="ml-2 text-gray-600">{fmtDate(a.at)}</span>
                      </div>
                      <div className="text-gray-500">#{node.attempts.length - i}</div>
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
