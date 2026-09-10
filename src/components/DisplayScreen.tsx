"use client";

import { useEffect, useState } from "react";
import { DISPLAY_CHANGED_EVENT, type DisplayView } from "@/lib/display-events";

const NOTICE_TEXT =
  "以下内容由大模型生成，未做安全隔离。请勿在其中输入敏感信息。";

type DisplayScreenProps = {
  /** SSR-resolved state so the first paint is already correct (DEC-017 ④, same pattern as DEC-011). */
  initial: DisplayView;
  /** Test seam. */
  fetchView?: () => Promise<DisplayView>;
};

async function fetchViewFromApi(): Promise<DisplayView> {
  const response = await fetch("/api/display", { headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`display fetch failed (${response.status})`);
  }
  return (await response.json()) as DisplayView;
}

export function DisplayScreen({ initial, fetchView = fetchViewFromApi }: DisplayScreenProps) {
  const [view, setView] = useState<DisplayView>(initial);

  // CR-20260909-display-screen CP-9: refetch on the custom event only — no polling, no SSE.
  useEffect(() => {
    let cancelled = false;
    const onChange = () => {
      fetchView()
        .then((next) => {
          if (!cancelled) {
            setView(next);
          }
        })
        .catch(() => {
          /* leave the current view in place */
        });
    };
    window.addEventListener(DISPLAY_CHANGED_EVENT, onChange);
    return () => {
      cancelled = true;
      window.removeEventListener(DISPLAY_CHANGED_EVENT, onChange);
    };
  }, [fetchView]);

  if (view.kind === "insight" && view.html != null) {
    return (
      <section className="display-screen display-screen--insight" aria-label="技能洞察">
        {/* CP-7: non-dismissible — no close control, no Escape handler. */}
        <div className="display-screen__notice" role="note">
          {NOTICE_TEXT}
        </div>
        {/* DEC-015 / CP-11: rendered without a sandbox attribute — the user accepts the risk. */}
        <iframe className="display-screen__frame" title="技能洞察报告" srcDoc={view.html} />
      </section>
    );
  }

  // "home" and every unrecognised kind fall back to the title view (CP-6).
  return (
    <section className="display-screen display-screen--home" aria-label="Agent-Jarvis">
      <div className="display-screen__title">
        <h1>Agent-Jarvis</h1>
        <p>本机运行的动态显示屏。在下方对话框提问；技能洞察与其它内容会在这里呈现。</p>
      </div>
    </section>
  );
}
