const fs = require('fs');
let content = fs.readFileSync('src/routes/_authenticated/financeiro.tsx', 'utf8');

// Normalize line endings
content = content.replace(/\r\n/g, '\n');

// 1. Add renderDreSections inside component before return
const insertPos = content.indexOf('if (!unlocked) return null;\n\n  return (');
if (insertPos === -1) {
  console.error('Could not find insertion point');
  process.exit(1);
}

const renderFunction = `
      {/* renderDreSections function - must be inside component to access openSections/toggleSection/fmtMoney */}
      const renderDreSections = (rows, kpis) => {
        const sections = [
          { key: 'RECEITA BRUTA', title: 'RECEITA BRUTA', icon: TrendingUp, tone: 'success' },
          { key: 'CUSTO DIRETO (CMV)', title: 'CUSTO DIRETO (CMV)', icon: Package, tone: 'warning' },
          { key: 'LUCRO BRUTO', title: 'LUCRO BRUTO', icon: PiggyBank, tone: 'info' },
          { key: 'DESPESAS OPERACIONAIS', title: 'DESPESAS OPERACIONAIS', icon: Users, tone: 'danger' },
          { key: 'DESPESA ADMINISTRATIVA', title: 'DESPESAS ADMINISTRATIVAS', icon: Calculator, tone: 'danger' },
          { key: 'DESPESA FINANCEIRA', title: 'DESPESAS FINANCEIRAS', icon: DollarSign, tone: 'danger' },
          { key: 'OUTROS', title: 'OUTRAS DESPESAS', icon: AlertTriangle, tone: 'danger' },
          { key: 'RESULTADO LÍQUIDO', title: 'RESULTADO LÍQUIDO', icon: TrendingDown, tone: 'info' },
        ];

        return sections.flatMap((section) => {
          const sectionRows = rows.filter(r => r.secao === section.key);
          const total = sectionRows.reduce((s, r) => s + r.valor, 0);
          const isTotalRow = ['LUCRO BRUTO', 'RESULTADO LÍQUIDO'].includes(section.key);
          const isOpen = openSections[section.key] ?? true;

          if (sectionRows.length === 0 && !isTotalRow) return null;

          const rowsToRender = [
            <TableRow
              key={section.key + '-header'}
              className='bg-muted/30 hover:bg-muted/50 cursor-pointer'
              onClick={() => toggleSection(section.key)}
            >
              <TableCell className='font-semibold flex items-center gap-2'>
                <section.icon className={'size-4 ' + (section.tone === 'success' ? 'text-success' : section.tone === 'warning' ? 'text-warning' : section.tone === 'danger' ? 'text-destructive' : 'text-info')} />
                {section.title}
              </TableCell>
              <TableCell />
              <TableCell />
              <TableCell className='text-right font-display text-lg font-semibold tabular'>{fmtMoney(total)}</TableCell>
              <TableCell className='text-center text-xs text-muted-foreground'>{sectionRows.filter(r => r.fonte === 'auto').length} auto / {sectionRows.filter(r => r.fonte === 'manual').length} manual</TableCell>
              <TableCell className='text-right'>
                <ChevronDown className={'size-4 mx-auto text-muted-foreground transition-transform ' + (isOpen ? 'rotate-180' : '')} />
              </TableCell>
            </TableRow>
          ];

          if (isOpen) {
            sectionRows.forEach((r, i) => {
              rowsToRender.push(
                <TableRow key={r.id ?? i} className={r.fonte === 'manual' ? 'bg-amber-50/30' : ''}>
                  <TableCell className='text-xs text-muted-foreground'>{r.secao}</TableCell>
                  <TableCell className='font-medium'>{r.categoria}</TableCell>
                  <TableCell className='text-muted-foreground text-sm'>{r.descricao || '—'}</TableCell>
                  <TableCell className='text-right tabular font-medium'>{fmtMoney(r.valor)}</TableCell>
                  <TableCell className='text-center'>
                    <Badge variant={r.fonte === 'auto' ? 'default' : 'outline'} className='text-xs'>
                      {r.fonte === 'auto' ? 'Automático' : 'Manual'}
                    </Badge>
                  </TableCell>
                  <TableCell className='text-right'>
                    {r.editable && r.id && (
                      <Button variant='ghost' size='icon' onClick={(e) => { e.stopPropagation(); }}>
                        <Pencil className='size-4' />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            });

            if (isTotalRow) {
              rowsToRender.push(
                <TableRow key={section.key + '-total'} className='bg-muted/50 font-bold'>
                  <TableCell colSpan={3} className='text-right'>Total {section.title}</TableCell>
                  <TableCell className='text-right font-display text-lg'>{fmtMoney(total)}</TableCell>
                  <TableCell colSpan={2} />
                </TableRow>
              );
            }
          }

          return rowsToRender;
        });
      };

`;

let result = content.slice(0, insertPos) + renderFunction + content.slice(insertPos);

// 2. Remove external renderDreSections function but keep InsightCard
const externalFuncStart = result.indexOf('function renderDreSections(rows, kpis) {');
if (externalFuncStart !== -1) {
  // Find the InsightCard function (should be before renderDreSections)
  const insightCardStart = result.lastIndexOf('function InsightCard(', externalFuncStart);
  if (insightCardStart !== -1) {
    // Keep everything up to externalFuncStart, remove renderDreSections
    result = result.slice(0, externalFuncStart);
  }
}

fs.writeFileSync('src/routes/_authenticated/financeiro.tsx', result);
console.log('Done');