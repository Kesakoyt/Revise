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
    if (typeof window !== 'undefined' && window.marked) {
      if (typeof window.marked.setOptions === 'function') {
        window.marked.setOptions({ gfm: true, breaks: true, headerIds: false, mangle: false });
      }
      try {
        if (typeof window.marked.parse === 'function') return window.marked.parse(markdown || '');
        if (typeof window.marked === 'function') return window.marked(markdown || '');
      } catch (err) {
        console.warn('[Converter] marked failed, using fallback:', err);
      }
    }
    return escapeHtml(markdown).replace(/\n/g, '<br>');
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
