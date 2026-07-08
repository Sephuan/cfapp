import { useState } from "react";
import { useKeyboard } from "@opentui/react";
import { type CFConfig, saveConfig } from "../config";

interface LoginProps { config: CFConfig; onDone: () => void; }

export function LoginScreen({ config, onDone }: LoginProps) {
  const [handle, setHandle] = useState(config.handle);
  const [apiKey, setApiKey] = useState(config.apiKey);
  const [apiSecret, setApiSecret] = useState(config.apiSecret);
  const [password, setPassword] = useState(config.password);
  const [proxy, setProxy] = useState(config.proxy);
  const [focusIdx, setFocusIdx] = useState(0);
  const [msg, setMsg] = useState("");

  const fields = [
    { label: "Handle", value: handle, set: setHandle, ph: "your_cf_handle" },
    { label: "API Key", value: apiKey, set: setApiKey, ph: "from settings/api" },
    { label: "API Secret", value: apiSecret, set: setApiSecret, ph: "from settings/api" },
    { label: "Password", value: password, set: setPassword, ph: "cf_login_password" },
    { label: "Proxy", value: proxy, set: setProxy, ph: "http://127.0.0.1:7890" },
  ];

  useKeyboard((key) => {
    if (key.name === "escape") onDone();
    else if (key.name === "tab") setFocusIdx((i) => (i + 1) % (fields.length + 1));
    else if (key.name === "return" && focusIdx === fields.length) {
      if (!handle.trim()) { setMsg("✗ Handle required!"); return; }
      saveConfig({ handle: handle.trim(), apiKey: apiKey.trim(), apiSecret: apiSecret.trim(), password: password.trim(), proxy: proxy.trim(), verifySsl: config.verifySsl });
      Object.assign(config, { handle: handle.trim(), apiKey: apiKey.trim(), apiSecret: apiSecret.trim(), password: password.trim(), proxy: proxy.trim() });
      setMsg("✓ Saved!"); setTimeout(onDone, 500);
    }
  });

  return (
    <box flexDirection="column" width="100%" height="100%" justifyContent="center" alignItems="center">
      <box flexDirection="column" width={60} border="rounded" borderColor="#e94560" padding={1}>
        <box marginBottom={1} justifyContent="center" flexDirection="row">
          <box><text><span bold fg="#e94560">CF TUI</span><span bold fg="white"> Configuration</span></text></box>
        </box>
        <box marginBottom={1}>
          <text fg="#53a8b6">API Key/Secret: https://codeforces.com/settings/api</text>
        </box>
        {fields.map((f, i) => (
          <box key={f.label} flexDirection="column" marginBottom={1}>
            <text><span fg={focusIdx === i ? "#e94560" : "#444"}>{focusIdx === i ? "▸" : " "}</span><span bold fg={focusIdx === i ? "white" : "#888"}> {f.label}</span></text>
            <box marginLeft={2}>
              <input value={f.value} onChange={(v: string) => f.set(v)} placeholder={f.ph} focused={focusIdx === i} />
            </box>
          </box>
        ))}
        <box marginTop={1} justifyContent="center" flexDirection="row">
          <box border={focusIdx === fields.length ? "bold" : "single"} borderColor={focusIdx === fields.length ? "#16c79a" : "#333"} paddingX={2}>
            <text><span bold fg={focusIdx === fields.length ? "#16c79a" : "#555"}>[ Save &amp; Continue ]</span></text>
          </box>
        </box>
        {msg ? <box marginTop={1} justifyContent="center"><text fg={msg.startsWith("✓") ? "#16c79a" : "#e94560"} bold>{msg}</text></box> : null}
        <box marginTop={1} justifyContent="center"><text fg="#555">Tab: next | Enter: save | Esc: skip</text></box>
      </box>
    </box>
  );
}
