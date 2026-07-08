import { useState, useCallback } from "react";
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { loadConfig, type CFConfig } from "./config";
import { type Contest, type Problem } from "./api";
import { LoginScreen } from "./screens/login";
import { ContestsScreen } from "./screens/contests";
import { ProblemsScreen } from "./screens/problems";
import { ProblemDetailScreen } from "./screens/problem-detail";
import { StandingsScreen } from "./screens/standings";
import { SubmitScreen } from "./screens/submit";
import { SubmissionsScreen } from "./screens/submissions";

type Screen =
  | { type: "login" }
  | { type: "contests" }
  | { type: "problems"; contest: Contest }
  | { type: "problem-detail"; problem: Problem }
  | { type: "standings"; contestId: number }
  | { type: "submit"; problem: Problem }
  | { type: "submissions"; contestId: number };

function App() {
  const [config] = useState<CFConfig>(() => loadConfig());
  const [screen, setScreen] = useState<Screen>(
    config.handle ? { type: "contests" } : { type: "login" }
  );
  const [stack, setStack] = useState<Screen[]>([]);

  const push = useCallback((s: Screen) => {
    setStack((prev) => [...prev, screen]);
    setScreen(s);
  }, [screen]);

  const pop = useCallback(() => {
    setStack((prev) => {
      const ns = [...prev];
      const prev_ = ns.pop();
      if (prev_) setScreen(prev_);
      return ns;
    });
  }, []);

  switch (screen.type) {
    case "login":
      return <LoginScreen config={config} onDone={() => { setScreen({ type: "contests" }); setStack([]); }} />;
    case "contests":
      return <ContestsScreen config={config} onSelect={(c) => push({ type: "problems", contest: c })} onStandings={(id) => push({ type: "standings", contestId: id })} onLogin={() => push({ type: "login" })} />;
    case "problems":
      return <ProblemsScreen config={config} contest={screen.contest} onView={(p) => push({ type: "problem-detail", problem: p })} onSubmit={(p) => push({ type: "submit", problem: p })} onStandings={() => push({ type: "standings", contestId: screen.contest.id })} onSubmissions={() => push({ type: "submissions", contestId: screen.contest.id })} onBack={pop} />;
    case "problem-detail":
      return <ProblemDetailScreen config={config} problem={screen.problem} onSubmit={() => push({ type: "submit", problem: screen.problem })} onBack={pop} />;
    case "standings":
      return <StandingsScreen config={config} contestId={screen.contestId} onBack={pop} />;
    case "submit":
      return <SubmitScreen config={config} problem={screen.problem} onBack={pop} />;
    case "submissions":
      return <SubmissionsScreen config={config} contestId={screen.contestId} onBack={pop} />;
  }
}

async function main() {
  const renderer = await createCliRenderer();
  createRoot(renderer).render(<App />);
}

main().catch(console.error);
