/**
 * Fiches & Cloud — Conversion & rendering service.
 *
 *  • PDF  → Markdown   (PDF.js text extraction)
 *  • DOCX → Markdown   (Mammoth HTML, then a small HTML→Markdown reducer)
 *  • MD   → HTML       (Marked, GitHub-flavoured)
 *  • Math → KaTeX      (delimiter auto-render)
 *
 * Every document is converted to Markdown *client-side*; no binary ever
 * reaches Firestore.
 */

/** Escape a string for safe HTML text insertion. */
function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Reduce a Mammoth-generated HTML fragment to Markdown.
 * Covers the constructs Mammoth actually emits (headings, bold/italic, lists,
 * tables, links, blockquotes, code).
 * @param {string} html
 * @returns {string}
 */
function htmlToMarkdown(html = '') {
  if (!html) return '';
  let md = html;

  // Tables → pipe tables (best effort)
  md = md.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_, body) => {
    const rows = [...body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
    if (!rows.length) return '';
    const cells = row => [...row.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)]
      .map(c => c[1].replace(/<[^>]+>/g, '').trim());
    const header = cells(rows[0]);
    const lines = [
      `| ${header.join(' | ')} |`,
      `| ${header.map(() => '---').join(' | ')} |`,
      ...rows.slice(1).map(r => `| ${cells(r).join(' | ')} |`)
    ];
    return `\n${lines.join('\n')}\n\n`;
  });

  // Headings
  for (let level = 6; level >= 1; level--) {
    md = md.replace(new RegExp(`<h${level}[^>]*>(.*?)</h${level}>`, 'gis'), `\n${'#'.repeat(level)} $1\n\n`);
  }

  // Emphasis
  md = md.replace(/<(?:strong|b)[^>]*>(.*?)<\/(?:strong|b)>/gis, '**$1**');
  md = md.replace(/<(?:em|i)[^>]*>(.*?)<\/(?:em|i)>/gis, '*$1*');

  // Code
  md = md.replace(/<pre[^>]*>\s*<code[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gis, '\n```\n$1\n```\n\n');
  md = md.replace(/<code[^>]*>(.*?)<\/code>/gis, '`$1`');

  // Links
  md = md.replace(/<a\s+(?:[^>]*?\s+)?href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gis, '[$2]($1)');

  // Lists
  md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gis, '- $1\n');
  md = md.replace(/<\/?(?:ul|ol)[^>]*>/gis, '\n');

  // Blockquotes
  md = md.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gis, (_, inner) => {
    const quoted = inner.trim().split('\n').map(line => `> ${line.trim()}`).join('\n');
    return `\n${quoted}\n\n`;
  });

  // Paragraphs, breaks, rules
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gis, '$1\n\n');
  md = md.replace(/<br\s*\/?>/gis, '\n');
  md = md.replace(/<hr\s*\/?>/gis, '\n---\n\n');

  // Strip leftovers + decode entities
  md = md.replace(/<[^>]+>/g, '');
  md = md
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  return md.replace(/\n{3,}/g, '\n\n').trim();
}

let turndownInstance = null;

/**
 * Lazily build the shared Turndown converter used by the WYSIWYG editor.
 * Returns `null` when the CDN script has not loaded (offline).
 * @returns {Object|null}
 */
function getTurndown() {
  if (turndownInstance) return turndownInstance;
  if (typeof window === 'undefined' || typeof window.TurndownService !== 'function') return null;

  const td = new window.TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    strongDelimiter: '**',
    linkStyle: 'inlined'
  });

  const gfm = window.turndownPluginGfm;
  if (gfm?.gfm) td.use(gfm.gfm);
  else if (gfm) {
    if (gfm.tables) td.use(gfm.tables);
    if (gfm.strikethrough) td.use(gfm.strikethrough);
    if (gfm.taskListItems) td.use(gfm.taskListItems);
  }

  // Constructs Markdown has no syntax for — keep the HTML (Marked passes it).
  td.keep(['u', 'mark', 'sup', 'sub']);

  // The GFM plugin emits single tildes; GFM/Marked need double tildes.
  td.addRule('strikethroughDouble', {
    filter: ['del', 's', 'strike'],
    replacement: content => `~~${content}~~`
  });

  // The ribbon's "Code" block creates a bare <pre> (no <code> child), which the
  // built-in code rules ignore; store it as a fenced block anyway.
  td.addRule('barePre', {
    filter: node => node.nodeName === 'PRE' &&
      !(node.firstChild && node.firstChild.nodeName === 'CODE'),
    replacement: (content, node) => {
      const code = node.textContent.replace(/\n$/, '');
      const fence = code.includes('```') ? '````' : '```';
      return `\n\n${fence}\n${code}\n${fence}\n\n`;
    }
  });

  // Soft line breaks; Marked runs with `breaks: true` and turns them back into
  // <br>, so the round-trip is stable and does not accumulate trailing spaces.
  // Inside a table cell a newline would break the pipe table, so it becomes a
  // space instead.
  td.addRule('softBreak', {
    filter: 'br',
    replacement: (content, node) => {
      let parent = node.parentNode;
      while (parent) {
        if (parent.nodeName === 'TD' || parent.nodeName === 'TH') return ' ';
        parent = parent.parentNode;
      }
      return '\n';
    }
  });

  // Tables: collapse multi-line cells so the GFM pipe table stays valid.
  td.addRule('tableCellSafe', {
    filter: ['th', 'td'],
    replacement: (content, node) => {
      const index = Array.prototype.indexOf.call(node.parentNode.childNodes, node);
      const prefix = index === 0 ? '| ' : ' ';
      return `${prefix}${content.replace(/\s*\n\s*/g, ' ').trim()} |`;
    }
  });

  // Some browsers and pasted Word/Docs content express emphasis as styled
  // spans rather than <strong>/<em>/<u>. Combine every style carried by the
  // span so bold+italic survives as ***…***.
  const styleOf = node => (node.getAttribute && node.getAttribute('style')) || '';
  td.addRule('styledSpan', {
    filter: node => node.nodeName === 'SPAN' &&
      /(font-weight|font-style|text-decoration)/i.test(styleOf(node)),
    replacement: (content, node) => {
      const style = styleOf(node);
      let out = content;
      if (/text-decoration[^;]*underline/i.test(style)) out = `<u>${out}</u>`;
      if (/text-decoration[^;]*line-through/i.test(style)) out = `~~${out}~~`;
      if (/font-style\s*:\s*italic/i.test(style)) out = `*${out}*`;
      if (/font-weight\s*:\s*(bold|[6-9]00)/i.test(style)) out = `**${out}**`;
      return out;
    }
  });

  // Word-style paragraph alignment survives as a raw block.
  td.addRule('alignedBlock', {
    filter: node => /^(P|H[1-6]|DIV)$/.test(node.nodeName) &&
      /text-align\s*:/i.test(node.getAttribute('style') || ''),
    replacement: (content, node) => {
      const body = content.replace(/^\n+|\n+$/g, '');
      // Keep the heading level when there is one.
      if (/^H[1-6]$/.test(node.nodeName)) {
        const tag = node.nodeName.toLowerCase();
        return `\n\n<${tag} style="${node.getAttribute('style')}">\n\n${body}\n\n</${tag}>\n\n`;
      }
      return `\n\n<div style="${node.getAttribute('style')}">\n\n${body}\n\n</div>\n\n`;
    }
  });

  turndownInstance = td;
  return td;
}

export const ConverterService = {
  /**
   * Extract a PDF's text into Markdown. Uses the global PDF.js from the CDN.
   * @param {File|Blob} file
   * @returns {Promise<string>}
   */
  async pdfToMarkdown(file) {
    if (typeof window === 'undefined' || !window.pdfjsLib) {
      throw new Error('La bibliothèque PDF.js (window.pdfjsLib) n’est pas chargée.');
    }

    if (!window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
    }

    const data = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data }).promise;
    const pages = [];

    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();

      let lastY = null;
      let pageText = '';

      for (const item of content.items) {
        const y = item.transform[5];
        if (lastY !== null && Math.abs(y - lastY) > 5) {
          pageText += '\n';
        } else if (pageText && !pageText.endsWith('\n') && !pageText.endsWith(' ')) {
          pageText += ' ';
        }
        pageText += item.str;
        lastY = y;
      }

      const text = pageText.trim();
      pages.push(pdf.numPages > 1 ? `## Page ${n}\n\n${text}` : text);
    }

    return pages.join('\n\n---\n\n');
  },

  /**
   * Convert a DOCX file into Markdown via Mammoth.
   * @param {File|Blob} file
   * @returns {Promise<string>}
   */
  async docxToMarkdown(file) {
    if (typeof window === 'undefined' || !window.mammoth) {
      throw new Error('La bibliothèque Mammoth.js (window.mammoth) n’est pas chargée.');
    }
    const arrayBuffer = await file.arrayBuffer();
    const result = await window.mammoth.convertToHtml({ arrayBuffer });
    return htmlToMarkdown(result.value || '');
  },

  /**
   * Detect the file type and convert it to Markdown.
   * Supports .pdf, .docx, .md and .txt (plus a text fallback).
   * @param {File} file
   * @returns {Promise<{ markdown: string, title: string }>}
   */
  async convertFile(file) {
    if (!file) throw new Error('Aucun fichier fourni.');

    const title = file.name ? file.name.replace(/\.[^/.]+$/, '') : 'Sans titre';
    const name = (file.name || '').toLowerCase();
    const mime = (file.type || '').toLowerCase();

    let markdown = '';

    if (name.endsWith('.pdf') || mime === 'application/pdf') {
      markdown = await this.pdfToMarkdown(file);
    } else if (
      name.endsWith('.docx') ||
      mime.includes('wordprocessingml') ||
      mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ) {
      markdown = await this.docxToMarkdown(file);
    } else if (name.endsWith('.md') || name.endsWith('.txt') || mime.startsWith('text/')) {
      markdown = await file.text();
    } else {
      markdown = await file.text();
    }

    return { markdown, title };
  },

  /**
   * Render Markdown to an HTML string with Marked (GFM).
   * @param {string} markdown
   * @returns {string}
   */
  renderMarkdown(markdown = '') {
    const source = String(markdown ?? '');

    // Protect math from Marked's inline parsing: `\,`, `*` or `<` inside a
    // formula must reach KaTeX untouched. Placeholders survive Marked and are
    // swapped for HTML-escaped formulas afterwards.
    const maths = [];
    const token = `FCNMATH${Math.random().toString(36).slice(2)}`;
    const guarded = source.replace(/\$\$[\s\S]*?\$\$|\$[^$\n]+?\$/g, match => {
      maths.push(match);
      return `${token}${maths.length - 1}END`;
    });
    const restoreMath = html => html.replace(
      new RegExp(`${token}(\\d+)END`, 'g'),
      (_, i) => escapeHtml(maths[Number(i)] ?? '')
    );

    if (typeof window !== 'undefined' && window.marked) {
      if (typeof window.marked.setOptions === 'function') {
        window.marked.setOptions({ gfm: true, breaks: true, headerIds: false, mangle: false });
      }
      try {
        if (typeof window.marked.parse === 'function') return restoreMath(window.marked.parse(guarded));
        if (typeof window.marked === 'function') return restoreMath(window.marked(guarded));
      } catch (err) {
        console.warn('[Converter] marked failed, using fallback:', err);
      }
    }
    return restoreMath(escapeHtml(guarded).replace(/\n/g, '<br>'));
  },

  /**
   * Convert editor HTML (contenteditable) to Markdown for storage.
   *
   * Uses Turndown + the GFM plugin so headings, lists, tables, strikethrough
   * and fenced code round-trip. Math spans are protected from Turndown's
   * escaping so `$x_1$` does not become `$x\_1$`, and constructs Markdown has
   * no syntax for (underline, alignment) are kept as inline HTML, which Marked
   * passes through.
   *
   * @param {string} html
   * @returns {string}
   */
  editorHtmlToMarkdown(html = '') {
    const td = getTurndown();

    // Pull math out before escaping, put it back afterwards.
    const maths = [];
    const token = `@@MATH${Math.random().toString(36).slice(2)}`;
    const decodeMathEntities = str => str
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&');
    const guarded = String(html ?? '').replace(/\$\$[^<]*?\$\$|\$[^<$\n]+?\$/g, match => {
      maths.push(decodeMathEntities(match));
      return `${token}${maths.length - 1}@@`;
    });

    const restoreMath = md => md.replace(
      new RegExp(`${token}(\\d+)@@`, 'g'),
      (_, i) => maths[Number(i)] ?? ''
    );

    if (td) {
      try {
        return restoreMath(td.turndown(guarded)).trim();
      } catch (err) {
        console.warn('[Converter] Turndown failed, using fallback:', err);
      }
    }

    // Fallback: plain text, still no HTML shown to the user.
    return restoreMath(guarded.replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim());
  },

  /**
   * Typeset KaTeX math inside a container. Supports `$…$`, `$$…$$`, `\(…\)`
   * and `\[…\]`.
   * @param {HTMLElement} element
   */
  renderMathInElement(element) {
    if (!element || typeof window === 'undefined') return;
    if (typeof window.renderMathInElement !== 'function') return;

    try {
      window.renderMathInElement(element, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '$', right: '$', display: false },
          { left: '\\(', right: '\\)', display: false },
          { left: '\\[', right: '\\]', display: true }
        ],
        throwOnError: false,
        errorColor: '#d13438'
      });
    } catch (err) {
      console.warn('[Converter] renderMathInElement failed:', err);
    }
  },

  /** @param {string} markdown @returns {number} */
  getCharCount(markdown = '') {
    return typeof markdown === 'string' ? markdown.length : 0;
  }
};
