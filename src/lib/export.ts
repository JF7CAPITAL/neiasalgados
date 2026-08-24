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

export function downloadExcel(filename: string, rows: Record<string, unknown>[], headers?: { key: string; label: string }[]) {
  const csv = toCSV(rows, headers);
  const blob = new Blob([csv], { type: "application/vnd.ms-excel;charset=utf-8;" });
  triggerDownload(blob, filename.endsWith(".xls") ? filename : filename + ".xls");
}

export function downloadXLSX(filename: string, sheets: { name: string; headers: { key: string; label: string }[]; rows: Record<string, unknown>[] }[]) {
  try {
    const XLSX = require("xlsx");
    const wb = XLSX.utils.book_new();

    for (const sheet of sheets) {
      const cols = sheet.headers ?? Object.keys(sheet.rows[0] ?? {}).map((k) => ({ key: k, label: k }));
      const head = cols.map((c) => c.label);
      const body = sheet.rows.map((r) => cols.map((c) => r[c.key] ?? ""));
      const aoa = [head, ...body];
      const ws = XLSX.utils.aoa_to_sheet(aoa);

      // Auto-width columns
      const maxWidth = cols.map((c, i) => Math.max(c.label.length, ...body.map((r) => String(r[i] ?? "").length)));
      ws["!cols"] = maxWidth.map((w) => ({ wch: Math.min(w + 2, 50) }));

      XLSX.utils.book_append_sheet(wb, ws, sheet.name);
    }

    const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    triggerDownload(blob, filename.endsWith(".xlsx") ? filename : filename + ".xlsx");
  } catch (e) {
    console.error("XLSX export failed, falling back to CSV:", e);
    // Fallback to first sheet as CSV
    if (sheets.length > 0) {
      downloadCSV(filename, sheets[0].rows, sheets[0].headers);
    }
  }
}

/** Renderiza HTML em um iframe offscreen e dispara a impressão.
 *  Sem reflow na página visível, sem popup blocker, sem efeitos visuais. */
export function printHTML(html: string) {
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.top = "-9999px";
  iframe.style.left = "-9999px";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "none";
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument || iframe.contentWindow?.document;
  if (!doc) { iframe.remove(); return; }
  doc.open();
  doc.write(html);
  doc.close();
  setTimeout(() => {
    iframe.contentWindow?.print();
    setTimeout(() => iframe.remove(), 1000);
  }, 300);
}

function pageWrap(title: string, bodyHtml: string): string {
  return `
    <div style="font-family:system-ui,sans-serif;padding:40px;color:#1a1a1a;max-width:900px;margin:0 auto">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #b45309;padding-bottom:16px;margin-bottom:20px">
        <div style="font-size:22px;font-weight:800;color:#b45309;letter-spacing:.5px">
          Neia Salgados<small style="display:block;font-size:11px;font-weight:500;color:#888;text-transform:uppercase;letter-spacing:2px">Fábrica de Salgados</small>
        </div>
        <div style="text-align:right">
          <h1 style="font-size:18px;margin:0;color:#111">${escHtml(title)}</h1>
        </div>
      </div>
      ${bodyHtml}
      <div style="margin-top:32px;font-size:11px;color:#999;border-top:1px solid #eee;padding-top:12px">
        Documento gerado em ${new Date().toLocaleString("pt-BR")} — Neia Salgados ERP
      </div>
    </div>`;
}

function escHtml(v: unknown): string {
  return String(v ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
}

function tableHtml(headers: string[], rows: (string | number)[][], align?: ("left" | "right")[]): string {
  const th = headers.map((h, i) => `<th style="text-align:${align?.[i] === "right" ? "right" : "left"}">${escHtml(h)}</th>`).join("");
  const body = rows.length
    ? rows.map((row) =>
        `<tr>${row.map((cell, i) => `<td style="text-align:${align?.[i] === "right" ? "right" : "left"}">${escHtml(cell)}</td>`).join("")}</tr>`
      ).join("")
    : `<tr><td colspan="${headers.length}" style="text-align:center;color:#999;padding:14px">Sem dados.</td></tr>`;
  return `<table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:4px">
    <thead><tr>${th}</tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

const TABLE_STYLE = `
  table{width:100%;border-collapse:collapse;font-size:12px;margin-top:4px}
  th,td{padding:6px 8px;vertical-align:top;text-align:left}
  th{color:#57534e;font-weight:600}
  @media print{body{padding:0}}
`;

// ─── Report: Simple table ────────────────────────────────────────
export function printReport(title: string, rows: Record<string, unknown>[], headers: { key: string; label: string }[]) {
  const th = headers.map((h) => `<th>${escHtml(h.label)}</th>`).join("");
  const trs = rows.map((r) => `<tr>${headers.map((h) => `<td>${escHtml(r[h.key])}</td>`).join("")}</tr>`).join("");
  const html = pageWrap(title, `
    <p style="color:#666;font-size:12px;margin-top:0">Gerado em ${new Date().toLocaleString("pt-BR")}</p>
    <style>${TABLE_STYLE}</style>
    <table style="margin-top:16px"><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`);
  printHTML(html);
}

// ─── Documento de ordem (produção / compra) ──────────────────────
export function printOrderDoc(opts: {
  docTitle: string;
  numero: number | string;
  fields: { label: string; value: string }[];
}) {
  const rows = opts.fields
    .map((f) => `<tr><th>${escHtml(f.label)}</th><td>${escHtml(f.value ?? "—")}</td></tr>`)
    .join("");
  const html = pageWrap(opts.docTitle + " #" + opts.numero, `
    <style>
      ${TABLE_STYLE}
      th{width:38%;color:#57534e;font-weight:600}
      .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #b45309;padding-bottom:16px;margin-bottom:24px}
      .num{font-size:26px;font-weight:800;color:#b45309}
    </style>
    <div class="head">
      <div><h1 style="margin:0">${opts.docTitle}</h1><div class="num">#${opts.numero}</div></div>
    </div>
    <table><tbody>${rows}</tbody></table>`);
  printHTML(html);
}

// ─── Relatório de produção (completo) ────────────────────────────
export interface ReportSection {
  title: string;
  headers: string[];
  rows: (string | number)[][];
  align?: ("left" | "right")[];
}

export function printProductionReport(opts: {
  periodo: string;
  resumo: { label: string; value: string }[];
  sections: ReportSection[];
}) {
  const cards = opts.resumo
    .map((r) => `<div style="flex:1;min-width:150px;border:1px solid #e5e7eb;border-radius:8px;padding:12px;background:#faf5ee">
      <span style="display:block;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#8a7a68">${escHtml(r.label)}</span>
      <span style="display:block;font-size:20px;font-weight:800;color:#b45309;margin-top:4px">${escHtml(r.value)}</span>
    </div>`)
    .join("");

  const sections = opts.sections
    .map((s) => {
      const tbl = tableHtml(s.headers, s.rows, s.align);
      return `<h2 style="font-size:14px;color:#b45309;margin:26px 0 6px;border-bottom:1px solid #eee;padding-bottom:4px">${escHtml(s.title)}</h2>${tbl}`;
    })
    .join("");

  const html = pageWrap("Relatório de Produção", `
    <style>${TABLE_STYLE}</style>
    <p style="color:#666;font-size:12px">${escHtml(opts.periodo)}</p>
    <div style="display:flex;flex-wrap:wrap;gap:10px;margin:16px 0 8px">${cards}</div>
    ${sections}`);
  printHTML(html);
}

// ─── Relatório de estoque de salgados ────────────────────────────
export function printStockReport(products: { nome: string; atual: number; reservado: number; disponivel: number; minimo: number; ideal: number; situacao: string }[]) {
  const html = pageWrap("Estoque de Salgados", `
    <style>${TABLE_STYLE}</style>
    <p style="color:#666;font-size:12px">Total de ${products.length} produtos</p>
    ${tableHtml(
      ["Produto", "Atual", "Reservado", "Disponível", "Mínimo", "Ideal", "Situação"],
      products.map((p) => [p.nome, String(p.atual), String(p.reservado), String(p.disponivel), String(p.minimo), String(p.ideal), p.situacao]),
      ["left", "right", "right", "right", "right", "right", "left"],
    )}`);
  printHTML(html);
}

// ─── Relatório de produtos/insumos abaixo do mínimo ────────────────
export function printBelowMinimumReport(
  products: { nome: string; atual: number; minimo: number }[],
  title = "Produtos Abaixo do Mínimo",
) {
  const html = pageWrap(title, `
    <style>${TABLE_STYLE}</style>
    <p style="color:#666;font-size:12px">${products.length} registro(s) com estoque crítico</p>
    ${tableHtml(
      ["Item", "Estoque Atual", "Mínimo"],
      products.map((p) => [p.nome, String(p.atual), String(p.minimo)]),
      ["left", "right", "right"],
    )}`);
  printHTML(html);
}

// ─── Relatório de consumo ────────────────────────────────────────
export function printConsumptionReport(title: string, rows: { produto: string; quantidade: number; horario?: string }[]) {
  const html = pageWrap(title, `
    <style>${TABLE_STYLE}</style>
    <p style="color:#666;font-size:12px">Total de ${rows.length} registro(s)</p>
    ${tableHtml(
      ["Produto", "Quantidade", ...(rows[0]?.horario ? ["Horário"] : [])],
      rows.map((r) => [r.produto, String(r.quantidade), ...(r.horario ? [r.horario] : [])]),
      ["left", "right", "left"],
    )}`);
  printHTML(html);
}

// ─── Relatório de ordens de produção ─────────────────────────────
export function printProdOrdersReport(orders: { numero: number; item: string; tipo: string; necessaria: number; produzida: number | string; prioridade: string; status: string }[]) {
  const total = orders.reduce((s, o) => s + Number(o.necessaria), 0);
  const html = pageWrap("Ordens de Produção", `
    <style>${TABLE_STYLE}</style>
    <p style="color:#666;font-size:12px">${orders.length} ordem(ns) · ${total} unidades necessárias</p>
    ${tableHtml(
      ["Nº", "Item", "Tipo", "Necessário", "Produzido", "Prioridade", "Status"],
      orders.map((o) => [String(o.numero), o.item, o.tipo, String(o.necessaria), String(o.produzida), o.prioridade, o.status]),
      ["left", "left", "left", "right", "right", "left", "left"],
    )}`);
  printHTML(html);
}

// ─── Relatório de colaboradores (selecionáveis) ──────────────────
export function printCollaboratorsReport(collabs: { nome: string; telefone: string; observacoes: string }[]) {
  const html = pageWrap("Colaboradores", `
    <style>${TABLE_STYLE}</style>
    <p style="color:#666;font-size:12px">${collabs.length} colaborador(es)</p>
    ${tableHtml(
      ["Nome", "Telefone", "Observações"],
      collabs.map((c) => [c.nome, c.telefone || "—", c.observacoes || "—"]),
    )}`);
  printHTML(html);
}

// ─── Relatório de OP pendentes / em andamento / concluídas ──────
export function printOPStatusReport(title: string, orders: { numero: number; item: string; status: string }[]) {
  const html = pageWrap(title, `
    <style>${TABLE_STYLE}</style>
    <p style="color:#666;font-size:12px">${orders.length} ordem(ns)</p>
    ${tableHtml(
      ["Nº", "Item", "Status"],
      orders.map((o) => [String(o.numero), o.item, o.status]),
    )}`);
  printHTML(html);
}

// ─── Relatório de compras pendentes ──────────────────────────────
export function printPurchaseOrdersReport(orders: { numero: number; insumo: string; fornecedor: string; quantidade: number; valor: string; prioridade: string; status: string }[]) {
  const total = orders.reduce((s, o) => s + o.quantidade, 0);
  const html = pageWrap("Compras Pendentes", `
    <style>${TABLE_STYLE}</style>
    <p style="color:#666;font-size:12px">${orders.length} ordem(ns) · ${total} unidades</p>
    ${tableHtml(
      ["Nº", "Insumo", "Fornecedor", "Quantidade", "Valor", "Prioridade", "Status"],
      orders.map((o) => [String(o.numero), o.insumo, o.fornecedor, String(o.quantidade), o.valor, o.prioridade, o.status]),
      ["left", "left", "left", "right", "right", "left", "left"],
    )}`);
  printHTML(html);
}

// ─── Relatório de colaboradores em turno ─────────────────────────
export function printColabsTurnoReport(collabs: { nome: string; cargo: string; turno: string }[]) {
  const html = pageWrap("Colaboradores em Turno", `
    <style>${TABLE_STYLE}</style>
    <p style="color:#666;font-size:12px">${collabs.length} colaborador(es) em turno</p>
    ${tableHtml(
      ["Nome", "Cargo", "Turno"],
      collabs.map((c) => [c.nome, c.cargo || "—", c.turno || "—"]),
    )}`);
  printHTML(html);
}

// ─── Interno ─────────────────────────────────────────────────────
function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
