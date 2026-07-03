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


function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
