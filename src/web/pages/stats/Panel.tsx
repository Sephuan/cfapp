import type React from "react";

export function Panel({ title, subtitle, children, className }: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`stats-panel${className ? ` ${className}` : ""}`}>
      <div className="stats-panel-head">
        <h3>{title}</h3>
        {subtitle && <span className="stats-panel-sub">{subtitle}</span>}
      </div>
      <div className="stats-panel-body">{children}</div>
    </section>
  );
}
