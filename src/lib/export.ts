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
      <p>Gerado em ${new Date().toLocaleString("pt-BR")} — SalgaERP</p>
      <button onclick="window.print()">Imprimir / PDF</button>
      <table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>
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
