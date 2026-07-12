export function toCSV(rows: Record<string, unknown>[], headers?: { key: string; label: string }[]): string {
  if (!rows.length) return "";
  const cols = headers ?? Object.keys(rows[0]).map((k) => ({ key: k, label: k }));
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = cols.map((c) => esc(c.label)).join(";");
  const body = rows.map((r) => cols.map((c) => esc(r[c.key])).join(";")).join("\n");
  return "\uFEFF" + head + "\n" + body;
}

export function downloadCSV(filename: string, rows: Record<string, unknown>[], headers?: { key: string; label: string }[]) {
  const csv = toCSV(rows, headers);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  triggerDownload(blob, filename.endsWith(".csv") ? filename : filename + ".csv");
}

/** Excel opens CSV natively; we export .xls-compatible CSV with BOM for pt-BR. */
export function downloadExcel(filename: string, rows: Record<string, unknown>[], headers?: { key: string; label: string }[]) {
  const csv = toCSV(rows, headers);
  const blob = new Blob([csv], { type: "application/vnd.ms-excel;charset=utf-8;" });
  triggerDownload(blob, filename.endsWith(".xls") ? filename : filename + ".xls");
}

export function printReport(title: string, rows: Record<string, unknown>[], headers: { key: string; label: string }[]) {
  const w = window.open("", "_blank");
  if (!w) return;
  const th = headers.map((h) => `<th>${h.label}</th>`).join("");
  const trs = rows
    .map((r) => `<tr>${headers.map((h) => `<td>${r[h.key] ?? ""}</td>`).join("")}</tr>`)
    .join("");
  w.document.write(`
    <html><head><title>${title}</title>
    <style>
      body{font-family:system-ui,sans-serif;padding:24px;color:#111}
      h1{font-size:20px;margin-bottom:4px}
      p{color:#666;font-size:12px;margin-top:0}
      table{width:100%;border-collapse:collapse;margin-top:16px;font-size:12px}
      th,td{border:1px solid #ddd;padding:6px 8px;text-align:left}
      th{background:#f3f4f6}
      @media print{button{display:none}}
    </style></head>
    <body>
      <h1>${title}</h1>
      <p>Gerado em ${new Date().toLocaleString("pt-BR")} — Neia Salgados</p>
      <button onclick="window.print()">Imprimir / PDF</button>
      <table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>
    </body></html>`);
  w.document.close();
}

/** Opens a formatted single-order document ready to view, print or save as PDF. */
export function printOrderDoc(opts: {
  docTitle: string;
  numero: number | string;
  fields: { label: string; value: string }[];
  autoPrint?: boolean;
}) {
  const w = window.open("", "_blank");
  if (!w) return;
  const rows = opts.fields
    .map((f) => `<tr><th>${f.label}</th><td>${f.value ?? "—"}</td></tr>`)
    .join("");
  w.document.write(`
    <html><head><title>${opts.docTitle} #${opts.numero}</title>
    <style>
      *{box-sizing:border-box}
      body{font-family:system-ui,sans-serif;padding:40px;color:#1a1a1a;max-width:760px;margin:0 auto}
      .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #b45309;padding-bottom:16px;margin-bottom:24px}
      .brand{font-size:22px;font-weight:800;color:#b45309;letter-spacing:.5px}
      .brand small{display:block;font-size:11px;font-weight:500;color:#888;text-transform:uppercase;letter-spacing:2px}
      .doc{text-align:right}
      .doc h1{font-size:18px;margin:0;color:#111}
      .doc .num{font-size:26px;font-weight:800;color:#b45309}
      table{width:100%;border-collapse:collapse;font-size:13px;margin-top:8px}
      th,td{border:1px solid #e5e7eb;padding:9px 12px;text-align:left;vertical-align:top}
      th{background:#faf5ee;width:38%;color:#57534e;font-weight:600}
      .foot{margin-top:32px;font-size:11px;color:#999;border-top:1px solid #eee;padding-top:12px}
      .actions{margin-bottom:20px}
      .actions button{background:#b45309;color:#fff;border:0;border-radius:6px;padding:9px 16px;font-size:13px;font-weight:600;cursor:pointer}
      @media print{.actions{display:none}body{padding:0}}
    </style></head>
    <body>
      <div class="actions"><button onclick="window.print()">Imprimir / Salvar PDF</button></div>
      <div class="head">
        <div class="brand">Neia Salgados<small>Fábrica de Salgados</small></div>
        <div class="doc"><h1>${opts.docTitle}</h1><div class="num">#${opts.numero}</div></div>
      </div>
      <table><tbody>${rows}</tbody></table>
      <div class="foot">Documento gerado em ${new Date().toLocaleString("pt-BR")} — Neia Salgados ERP</div>
    </body></html>`);
  w.document.close();
  if (opts.autoPrint) setTimeout(() => w.print(), 400);
}

export interface ReportSection {
  title: string;
  headers: string[];
  rows: (string | number)[][];
  align?: ("left" | "right")[];
}

/** Relatório completo (período + cards + tabelas) no layout de marca Neia Salgados. */
export function printProductionReport(opts: {
  periodo: string;
  resumo: { label: string; value: string }[];
  sections: ReportSection[];
}) {
  const w = window.open("", "_blank");
  if (!w) return;
  const esc = (v: unknown) => String(v ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));

  const cards = opts.resumo
    .map((r) => `<div class="card"><span class="lbl">${esc(r.label)}</span><span class="val">${esc(r.value)}</span></div>`)
    .join("");

  const sections = opts.sections
    .map((s) => {
      const th = s.headers
        .map((h, i) => `<th style="text-align:${s.align?.[i] === "right" ? "right" : "left"}">${esc(h)}</th>`)
        .join("");
      const body = s.rows.length
        ? s.rows
            .map(
              (row) =>
                `<tr>${row
                  .map((cell, i) => `<td style="text-align:${s.align?.[i] === "right" ? "right" : "left"}">${esc(cell)}</td>`)
                  .join("")}</tr>`,
            )
            .join("")
        : `<tr><td colspan="${s.headers.length}" class="empty">Sem dados no período.</td></tr>`;
      return `<h2>${esc(s.title)}</h2><table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table>`;
    })
    .join("");

  w.document.write(`
    <html><head><title>Relatório de Produção — Neia Salgados</title>
    <style>
      *{box-sizing:border-box}
      body{font-family:system-ui,sans-serif;padding:40px;color:#1a1a1a;max-width:900px;margin:0 auto}
      .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #b45309;padding-bottom:16px;margin-bottom:20px}
      .brand{font-size:22px;font-weight:800;color:#b45309;letter-spacing:.5px}
      .brand small{display:block;font-size:11px;font-weight:500;color:#888;text-transform:uppercase;letter-spacing:2px}
      .doc{text-align:right}
      .doc h1{font-size:18px;margin:0;color:#111}
      .doc .num{font-size:13px;color:#666}
      .cards{display:flex;flex-wrap:wrap;gap:10px;margin:16px 0 8px}
      .card{flex:1;min-width:150px;border:1px solid #e5e7eb;border-radius:8px;padding:12px;background:#faf5ee}
      .card .lbl{display:block;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#8a7a68}
      .card .val{display:block;font-size:20px;font-weight:800;color:#b45309;margin-top:4px}
      h2{font-size:14px;color:#b45309;margin:26px 0 6px;border-bottom:1px solid #eee;padding-bottom:4px}
      table{width:100%;border-collapse:collapse;font-size:12px;margin-top:4px}
      th,td{border:1px solid #e5e7eb;padding:7px 10px;vertical-align:top}
      th{background:#faf5ee;color:#57534e;font-weight:600}
      .empty{text-align:center;color:#999;padding:14px}
      .foot{margin-top:32px;font-size:11px;color:#999;border-top:1px solid #eee;padding-top:12px}
      .actions{margin-bottom:20px}
      .actions button{background:#b45309;color:#fff;border:0;border-radius:6px;padding:9px 16px;font-size:13px;font-weight:600;cursor:pointer}
      @media print{.actions{display:none}body{padding:0}}
    </style></head>
    <body>
      <div class="actions"><button onclick="window.print()">Imprimir / Salvar PDF</button></div>
      <div class="head">
        <div class="brand">Neia Salgados<small>Fábrica de Salgados</small></div>
        <div class="doc"><h1>Relatório de Produção</h1><div class="num">${esc(opts.periodo)}</div></div>
      </div>
      <div class="cards">${cards}</div>
      ${sections}
      <div class="foot">Documento gerado em ${new Date().toLocaleString("pt-BR")} — Neia Salgados ERP</div>
    </body></html>`);
  w.document.close();
}




function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
