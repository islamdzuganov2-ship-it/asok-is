/**
 * check-ui.mjs — статический аудит визуальных инвариантов интерфейса (BL-007, UI-*).
 *
 * Зачем: «премиальность» ломается не одной крупной ошибкой, а десятками мелких расхождений —
 * карточка без общего слоя, число, выровненное по левому краю, свой оттенок мимо палитры.
 * Глазами это ловится плохо и невоспроизводимо, поэтому инварианты проверяются кодом и входят
 * в регресс (`npm run check:ui`, агрегатор — `npm run check`).
 *
 * Проверяются ИСХОДНИКИ, а не рантайм: правило должно срабатывать на ревью, до сборки.
 * Ложные срабатывания гасятся точечно комментарием `ui-audit-ignore <код>` в той же строке
 * ИЛИ на строке выше — с обязательным пояснением почему.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SRC = join(process.cwd(), 'src');
const THEME_DIR = join('src', 'theme');

/** Файлы, которым разрешено определять «сырьё» дизайна. */
const isThemeFile = (f) => f.includes(THEME_DIR);
/** Тесты и данные не участвуют в визуальном аудите. */
const isSkipped = (f) => f.includes('__tests__') || f.includes(`${sep}data${sep}`);

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.tsx?$/.test(p)) acc.push(p);
  }
  return acc;
}

const RULES = [
  {
    code: 'UI-01',
    title: 'Карточка вне premium-слоя',
    why: 'рядом с premium-карточками даёт другую рамку, тень и шапку — «сборная солянка»',
    severity: 'critical',
    // <Card ...> в файле, где ни разу не встречается premiumCard
    check(text, file) {
      if (isThemeFile(file)) return [];
      if (!/<Card[\s>]/.test(text)) return [];
      if (/premiumCard/.test(text)) return [];
      // CollapsibleCard сам оборачивает premiumCard
      if (/CollapsibleCard/.test(text) && !/<Card[\s>]/.test(text)) return [];
      return lines(text)
        .map(([n, l]) => (/<Card[\s>]/.test(l) ? { line: n, snippet: l.trim() } : null))
        .filter(Boolean);
    },
  },
  {
    code: 'UI-02',
    title: 'Числовая колонка таблицы без выравнивания вправо',
    why: 'разряды не встают друг под друга — числа нельзя сравнить взглядом',
    severity: 'critical',
    check(text, file) {
      if (isThemeFile(file)) return [];
      const out = [];
      // объект колонки в одной строке: есть числовой dataIndex/ключ и нет align
      const NUM = /(dataIndex|key):\s*'(score|count|pct|calculatedScore|avg_score|totalMetrics|filled|value_a|value_b|normalized_x|lowMetricsCount|avgMttrHours|measures|systems)'/;
      const all = lines(text);
      for (const [n, l] of all) {
        if (!/title:/.test(l)) continue;
        if (!NUM.test(l)) continue;
        if (/align:/.test(l)) continue;
        // Описание колонки может занимать несколько строк — обёртка `numericColumn(` стоит
        // на строке объявления или чуть выше.
        const window = all.slice(Math.max(0, n - 3), n).map(([, s]) => s).join(' ');
        if (/numericColumn/.test(window)) continue;
        out.push({ line: n, snippet: l.trim().slice(0, 110) });
      }
      return out;
    },
  },
  {
    code: 'UI-03',
    title: 'Цвет мимо палитры',
    why: 'свой оттенок рядом с токеном читается как случайный и ломает единство',
    severity: 'major',
    check(text, file) {
      if (isThemeFile(file)) return [];
      const out = [];
      for (const [n, l] of lines(text)) {
        if (/ui-audit-ignore/.test(l)) continue;
        const m = l.match(/#[0-9a-fA-F]{6}\b/g);
        if (!m) continue;
        // белый/чёрный как «бумага и чернила» допустимы
        const bad = m.filter((h) => !/^#(fff|FFF|000)/i.test(h));
        if (bad.length) out.push({ line: n, snippet: `${bad.join(', ')} — ${l.trim().slice(0, 80)}` });
      }
      return out;
    },
  },
  {
    code: 'UI-04',
    title: 'Размер шрифта мимо шкалы',
    why: 'размеры расходятся на 1–2px и перестают читаться как иерархия',
    severity: 'major',
    check(text, file) {
      if (isThemeFile(file)) return [];
      const out = [];
      for (const [n, l] of lines(text)) {
        if (/ui-audit-ignore/.test(l)) continue;
        if (/TYPE\./.test(l)) continue;
        const m = l.match(/fontSize:\s*(\d+(\.\d+)?)/);
        if (m) out.push({ line: n, snippet: l.trim().slice(0, 90) });
      }
      return out;
    },
  },
  {
    code: 'UI-05',
    title: 'Отступ вне сетки 4px',
    why: 'одинаковые по смыслу зазоры отличаются на 1–2px, ряд «плывёт»',
    severity: 'minor',
    check(text, file) {
      if (isThemeFile(file)) return [];
      const out = [];
      const P = /(marginTop|marginBottom|marginLeft|marginRight|paddingTop|paddingBottom|paddingLeft|paddingRight|gap|marginBlock|padding):\s*(\d+)\b/g;
      for (const [n, l] of lines(text)) {
        if (/ui-audit-ignore/.test(l)) continue;
        let m;
        while ((m = P.exec(l))) {
          const v = Number(m[2]);
          if (v > 0 && v % 4 !== 0) out.push({ line: n, snippet: `${m[1]}: ${v} — ${l.trim().slice(0, 70)}` });
        }
      }
      return out;
    },
  },
  {
    code: 'UI-06',
    title: 'Плашка с белым текстом мимо solidTagStyle',
    why: 'белый текст на светлом тоне не проходит WCAG AA — инвариант держит хелпер',
    severity: 'critical',
    check(text, file) {
      if (isThemeFile(file)) return [];
      return lines(text)
        .map(([n, l]) => (/<Tag[^>]*color:\s*'#(fff|FFF)/.test(l) && !/solidTagStyle/.test(l)
          ? { line: n, snippet: l.trim().slice(0, 100) } : null))
        .filter(Boolean);
    },
  },
  {
    code: 'UI-07',
    title: 'Таблица без пустого состояния',
    why: 'на пустых данных пользователь видит голую разметку без объяснения',
    severity: 'major',
    check(text, file) {
      if (isThemeFile(file)) return [];
      const all = lines(text);
      // Пустое состояние часто задаётся один раз в общем объекте пропсов и разливается
      // спредом (`{...tableProps}`) — такие таблицы покрыты, хотя `locale=` у них нет.
      const sharedEmpty = /locale:\s*\{\s*emptyText/.test(text);
      const out = [];
      for (const [n, l] of all) {
        if (!/<Table[\s>]/.test(l)) continue;
        // Тело JSX-элемента: от строки с <Table до закрывающего /> или </Table>.
        const body = [];
        for (let i = n - 1; i < Math.min(all.length, n + 24); i++) {
          body.push(all[i][1]);
          if (i > n - 1 && /\/>|<\/Table>/.test(all[i][1])) break;
        }
        const jsx = body.join(' ');
        if (/locale=/.test(jsx)) continue;
        if (sharedEmpty && /\{\.\.\./.test(jsx)) continue;
        out.push({ line: n, snippet: l.trim().slice(0, 80) });
      }
      return out;
    },
  },
  {
    code: 'UI-08',
    title: 'Число без табличных цифр',
    why: 'в пропорциональном шрифте цифры разной ширины — колонка «дрожит» при обновлении',
    severity: 'minor',
    check(text, file) {
      if (isThemeFile(file)) return [];
      const out = [];
      for (const [n, l] of lines(text)) {
        // рендер процента/числа в ячейке или показателе
        if (!/\$\{v\}%|\{v\}%|toFixed\(|calculatedScore|\{score\}%/.test(l)) continue;
        if (/tabular-nums/.test(l)) continue;
        if (!/(render|Text|span|b>)/.test(l)) continue;
        out.push({ line: n, snippet: l.trim().slice(0, 90) });
      }
      return out;
    },
  },
];

function lines(text) {
  return text.split(/\r?\n/).map((l, i) => [i + 1, l]);
}
function lineOf(text, needle) {
  const i = text.split(/\r?\n/).findIndex((l) => l.includes(needle));
  return i < 0 ? 1 : i + 1;
}

const files = walk(SRC).filter((f) => !isSkipped(f));
const findings = new Map(RULES.map((r) => [r.code, []]));

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const src = text.split(/\r?\n/);
  const rel = relative(process.cwd(), file).split(sep).join('/');
  /**
   * Подавление: маркер на самой строке или в комментарии над ней (до 3 строк — пояснение
   * почему исключение законно обычно не влезает в одну строку).
   */
  const suppressed = (line, code) => {
    const re = new RegExp(`ui-audit-ignore\\s+${code}`);
    return src.slice(Math.max(0, line - 4), line).some((l) => re.test(l));
  };
  for (const rule of RULES) {
    for (const hit of rule.check(text, file)) {
      if (suppressed(hit.line, rule.code)) continue;
      findings.get(rule.code).push({ file: rel, ...hit });
    }
  }
}

const ORDER = { critical: 0, major: 1, minor: 2 };
const rules = [...RULES].sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);

const argv = process.argv.slice(2);
const only = argv.find((a) => a.startsWith('--only='))?.slice(7);
const verbose = argv.includes('--verbose');
const failOn = argv.find((a) => a.startsWith('--fail-on='))?.slice(10) ?? 'critical';

let total = 0;
let blocking = 0;

for (const rule of rules) {
  if (only && rule.code !== only) continue;
  const hits = findings.get(rule.code);
  total += hits.length;
  if (ORDER[rule.severity] <= ORDER[failOn]) blocking += hits.length;
  const mark = hits.length === 0 ? 'ok  ' : rule.severity === 'critical' ? 'КРИТ' : rule.severity === 'major' ? 'ЗНАЧ' : 'МЕЛК';
  console.log(`${mark} ${rule.code} ${rule.title} — ${hits.length}`);
  if (hits.length && (verbose || only)) {
    const byFile = new Map();
    for (const h of hits) {
      if (!byFile.has(h.file)) byFile.set(h.file, []);
      byFile.get(h.file).push(h);
    }
    for (const [f, hs] of [...byFile.entries()].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`       ${f} (${hs.length})`);
      for (const h of hs.slice(0, verbose ? 100 : 3)) console.log(`         :${h.line}  ${h.snippet}`);
    }
  }
}

console.log(`\nВсего замечаний: ${total}. Блокирующих (severity ≤ ${failOn}): ${blocking}.`);
if (blocking > 0) {
  console.error('Регресс UI не пройден.');
  process.exit(1);
}
console.log('Инварианты UI соблюдены.');
