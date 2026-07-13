import { useEffect, useRef, useState } from "react";
import {
  applyFont, readFont, readCustomFontFamily, pickLang,
  CUSTOM_FONT_CHOICE_ID, FONT_ROLES,
  type FontRole,
} from "../../themes";
import { t, type Lang, type StrKey } from "../../i18n";

// Read-only diagnostic rows for the roles the user can't switch (the switchable
// ones — body/statement/display — get live pickers above). Shows which primary
// family each role resolved to and whether it actually loaded.
const DIAG_ROLES = [
  { labelKey: "diag.tr" as StrKey, cssVar: "--font-cjk", sample: "给你一个数组 a…", sampleStyle: {} },
  { labelKey: "diag.trLabel" as StrKey, cssVar: "--font-cjk-label", sample: "译", sampleStyle: { fontWeight: 700, fontSize: "0.8rem" } },
  { labelKey: "diag.code" as StrKey, cssVar: "--font-code", sample: "int main() {}", sampleStyle: {} },
] as const;

type CustomFontInfo = {
  id: string;
  family: string;
  faces: { file: string; weight: number; style: string }[];
  source?: string;
};

type LoadState = "loading" | "loaded" | "fallback";
function useFontLoadStatus(families: string[]): Record<string, LoadState> {
  const key = families.filter(Boolean).join("|");
  const [status, setStatus] = useState<Record<string, LoadState>>({});
  useEffect(() => {
    let cancelled = false;
    const list = families.filter(Boolean);
    setStatus(Object.fromEntries(list.map(f => [f, "loading" as LoadState])));
    for (const fam of list) {
      document.fonts.load(`16px "${fam}"`)
        .then(faces => {
          if (cancelled) return;
          setStatus(s => ({ ...s, [fam]: faces.length > 0 ? "loaded" : "fallback" }));
        })
        .catch(() => { if (!cancelled) setStatus(s => ({ ...s, [fam]: "fallback" })); });
    }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return status;
}

const LOAD_LABEL: Record<LoadState, StrKey> = {
  loading: "font.loading",
  loaded: "font.loaded",
  fallback: "font.fallback",
};

function useCustomFonts() {
  const [fonts, setFonts] = useState<CustomFontInfo[]>([]);
  const [msFamily, setMsFamily] = useState("Microsoft Georgia");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    try {
      const r = await fetch("/api/fonts/custom");
      const j = await r.json();
      setFonts(Array.isArray(j?.fonts) ? j.fonts : []);
      if (j?.msGeorgiaFamily) setMsFamily(String(j.msGeorgiaFamily));
      setErr(null);
    } catch (e: any) {
      setErr(e?.message || String(e));
    }
  };

  useEffect(() => { void reload(); }, []);

  // After upload/delete, re-pull fonts.css so @font-face updates without full reload.
  const refreshCss = () => {
    const links = document.querySelectorAll<HTMLLinkElement>('link[href*="/fonts/fonts.css"]');
    links.forEach((l) => {
      const u = new URL(l.href, location.origin);
      u.searchParams.set("t", String(Date.now()));
      l.href = u.pathname + u.search;
    });
  };

  const upload = async (file: File, family: string, weight: number, style: "normal" | "italic") => {
    setBusy(true);
    setErr(null);
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      let bin = "";
      const chunk = 0x8000;
      for (let i = 0; i < buf.length; i += chunk) {
        bin += String.fromCharCode(...buf.subarray(i, i + chunk));
      }
      const dataBase64 = btoa(bin);
      const fam = family.trim();
      // If this family already exists, send its id so the server merges faces
      // (italic/bold). Server also merges by family name as a safety net.
      const existingId = fonts.find((f) => f.family === fam)?.id;
      const r = await fetch("/api/fonts/custom", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          family: fam,
          ...(existingId ? { id: existingId } : {}),
          faces: [{ name: file.name, dataBase64, weight, style }],
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      await reload();
      refreshCss();
      return j.font as CustomFontInfo;
    } catch (e: any) {
      setErr(e?.message || String(e));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/fonts/custom/${encodeURIComponent(id)}`, { method: "DELETE" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      await reload();
      refreshCss();
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return { fonts, msFamily, err, busy, upload, remove };
}

export function FontRolePicker({ role, lang, customFonts }: {
  role: FontRole;
  lang: Lang;
  customFonts: CustomFontInfo[];
}) {
  const [value, setValue] = useState<string>(() => readFont(role));
  const [customFamily, setCustomFamily] = useState<string>(() => readCustomFontFamily(role));

  useEffect(() => {
    if (value !== CUSTOM_FONT_CHOICE_ID) return;
    if (customFamily && customFonts.some(f => f.family === customFamily)) return;
    if (customFonts.length === 1) {
      const fam = customFonts[0]!.family;
      setCustomFamily(fam);
      applyFont(role, CUSTOM_FONT_CHOICE_ID, fam);
    }
  }, [customFonts, value, customFamily, role]);

  const previewFamily = value === CUSTOM_FONT_CHOICE_ID
    ? (customFamily || "serif")
    : (role.choices.find(c => c.id === value)?.family || role.choices[0]!.family);

  const load = useFontLoadStatus(
    role.choices.map(c => c.family).filter(Boolean).concat(customFonts.map(f => f.family)),
  );
  const current = role.choices.find(c => c.id === value) ?? role.choices[0]!;
  const st: LoadState | "system" = current.system
    ? "system"
    : value === CUSTOM_FONT_CHOICE_ID
      ? (customFamily ? (load[customFamily] ?? "loading") : "fallback")
      : (load[current.family] ?? "loading");

  const onBuiltIn = (id: string) => {
    setValue(id);
    if (id === CUSTOM_FONT_CHOICE_ID) {
      const fam = customFamily || customFonts[0]?.family || "";
      setCustomFamily(fam);
      applyFont(role, CUSTOM_FONT_CHOICE_ID, fam);
    } else {
      applyFont(role, id);
    }
  };

  const onCustomFamily = (fam: string) => {
    setCustomFamily(fam);
    setValue(CUSTOM_FONT_CHOICE_ID);
    applyFont(role, CUSTOM_FONT_CHOICE_ID, fam);
  };

  return (
    <div className="field">
      <label>{pickLang(lang, role.label, role.labelEn)}</label>
      <div className="font-row">
        <select
          className="font-select"
          value={value}
          onChange={e => onBuiltIn(e.target.value)}
        >
          {role.choices.map(c => (
            <option key={c.id || "default"} value={c.id}>
              {c.id === CUSTOM_FONT_CHOICE_ID
                ? t(lang, "font.custom.choice")
                : `${c.name}${c.id === "" ? t(lang, "set.default") : ""}`}
            </option>
          ))}
        </select>
        <span className={`fp-status fp-${st}`}>
          {st === "system" ? t(lang, "set.system") : t(lang, LOAD_LABEL[st])}
        </span>
      </div>
      {value === CUSTOM_FONT_CHOICE_ID && (
        <div className="font-row" style={{ marginTop: "0.35rem" }}>
          <select
            className="font-select"
            value={customFamily}
            onChange={e => onCustomFamily(e.target.value)}
            disabled={customFonts.length === 0}
          >
            {customFonts.length === 0 && (
              <option value="">{t(lang, "font.custom.empty")}</option>
            )}
            {customFonts.map(f => (
              <option key={f.id} value={f.family}>{f.family}</option>
            ))}
          </select>
        </div>
      )}
      <div className="font-preview" style={{ fontFamily: `"${previewFamily}", Georgia, var(--font-cjk)` }}>
        {role.preview}
      </div>
      <span className="fp-hint">
        {value === CUSTOM_FONT_CHOICE_ID
          ? (customFamily
              ? t(lang, "font.custom.using").replace("{family}", customFamily)
              : t(lang, "font.custom.pickHint"))
          : pickLang(lang, current.hint, current.hintEn)}
      </span>
    </div>
  );
}

/** Full fonts section: custom library + per-role pickers (single fetch). */
export function FontsSection({ lang }: { lang: Lang }) {
  const lib = useCustomFonts();
  const fileRef = useRef<HTMLInputElement>(null);
  const [family, setFamily] = useState("");
  const [weight, setWeight] = useState(400);
  const [style, setStyle] = useState<"normal" | "italic">("normal");
  const [msg, setMsg] = useState<string | null>(null);

  const onPickFile = async (file: File | null) => {
    if (!file) return;
    const fam = family.trim()
      || file.name.replace(/\.(ttf|otf|woff2?)$/i, "").replace(/[-_]/g, " ");
    setFamily(fam);
    const font = await lib.upload(file, fam, weight, style);
    if (font) {
      setMsg(t(lang, "font.custom.uploaded").replace("{family}", font.family));
      setFamily("");
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <>
      <div className="field custom-font-lib">
        <label>{t(lang, "font.custom.lib")}</label>
        <p className="hint" style={{ margin: "0 0 0.45rem" }}>{t(lang, "font.custom.libHint")}</p>

        {lib.fonts.length > 0 && (
          <div className="custom-font-list">
            {lib.fonts.map(f => (
              <div key={f.id} className="custom-font-row">
                <div className="custom-font-meta">
                  <span
                    className="custom-font-name"
                    style={{ fontFamily: `"${f.family}", Georgia, serif` }}
                  >
                    {f.family}
                  </span>
                  <span className="custom-font-detail">
                    {f.faces.map(x => `${x.weight}${x.style === "italic" ? "i" : ""}`).join(" · ")}
                    {f.source
                      ? ` · ${f.source.length > 48 ? f.source.slice(0, 48) + "…" : f.source}`
                      : ""}
                  </span>
                </div>
                <button
                  type="button"
                  className="ai-btn"
                  disabled={lib.busy}
                  onClick={() => void lib.remove(f.id)}
                >{t(lang, "font.custom.delete")}</button>
              </div>
            ))}
          </div>
        )}

        <div className="custom-font-upload">
          <div className="font-row">
            <input
              value={family}
              onChange={e => setFamily(e.target.value)}
              placeholder={t(lang, "font.custom.familyPh")}
              style={{ flex: 1 }}
            />
            <select
              className="font-select"
              style={{ flex: "0 0 5.5rem" }}
              value={String(weight)}
              onChange={e => setWeight(Number(e.target.value))}
            >
              {[400, 500, 600, 700].map(w => (
                <option key={w} value={String(w)}>{w}</option>
              ))}
            </select>
            <select
              className="font-select"
              style={{ flex: "0 0 5.5rem" }}
              value={style}
              onChange={e => setStyle(e.target.value as "normal" | "italic")}
            >
              <option value="normal">{t(lang, "font.custom.normal")}</option>
              <option value="italic">{t(lang, "font.custom.italic")}</option>
            </select>
          </div>
          <div className="font-row" style={{ marginTop: "0.4rem" }}>
            <input
              ref={fileRef}
              type="file"
              accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2"
              style={{ display: "none" }}
              onChange={e => void onPickFile(e.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              className="rate-test-run"
              disabled={lib.busy}
              onClick={() => fileRef.current?.click()}
            >
              {lib.busy ? t(lang, "font.custom.uploading") : t(lang, "font.custom.upload")}
            </button>
          </div>
        </div>

        {lib.err && <span className="hint" style={{ color: "var(--err)" }}>{lib.err}</span>}
        {msg && !lib.err && <span className="hint" style={{ color: "var(--ok)" }}>{msg}</span>}
        {lib.fonts.some(f => f.family === lib.msFamily) && (
          <span className="hint">
            {t(lang, "font.custom.msHint").replace("{family}", lib.msFamily)}
          </span>
        )}
      </div>

      {FONT_ROLES.map(role => (
        <FontRolePicker
          key={role.key}
          role={role}
          lang={lang}
          customFonts={lib.fonts}
        />
      ))}
    </>
  );
}

export function FontInfoTable({ lang }: { lang: Lang }) {
  const [info, setInfo] = useState<{ primary: string; loaded: boolean }[]>([]);

  useEffect(() => {
    const check = () => {
      const root = getComputedStyle(document.documentElement);
      setInfo(DIAG_ROLES.map(r => {
        const stack = root.getPropertyValue(r.cssVar).trim();
        const primary = stack.split(",")[0]?.trim().replace(/^"|"$/g, "") || "serif";
        const loaded = document.fonts.check(`16px "${primary}"`);
        return { primary, loaded };
      }));
    };
    document.fonts.ready.then(check);
    document.fonts.addEventListener("loadingdone", check);
    return () => document.fonts.removeEventListener("loadingdone", check);
  }, []);

  if (!info.length) return null;

  return (
    <table className="font-info">
      <tbody>
        {DIAG_ROLES.map((r, i) => (
          <tr key={r.cssVar}>
            <th>{t(lang, r.labelKey)}</th>
            <td>
              <span className={info[i]?.loaded ? "fi-loaded" : "fi-fallback"}>
                {info[i]?.primary} {info[i]?.loaded ? "✓" : t(lang, "font.notLoaded")}
              </span>
              <br />
              <span className="fi-sample" style={{ fontFamily: `var(${r.cssVar})`, ...r.sampleStyle }}>{r.sample}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
