/**
 * Fiches & Cloud — Document Converter & Markdown / Math Rendering Service
 * 
 * Supports PDF text extraction (via pdfjsLib), DOCX to Markdown conversion (via mammoth),
 * GitHub Flavored Markdown parsing (via marked.js), and KaTeX math expression rendering.
 */

/**
 * Basic HTML to Markdown converter used for processing DOCX extraction output.
 * @param {string} html 
 * @returns {string}
 */
function htmlToMarkdown(html = '') {
  if (!html) return '';

  let md = html;

  // Headings
  md = md.replace(/<h1[^>]*>(.*?)<\/h1>/gis, '\n# $1\n\n');
  md = md.replace(/<h2[^>]*>(.*?)<\/h2>/gis, '\n## $1\n\n');
  md = md.replace(/<h3[^>]*>(.*?)<\/h3>/gis, '\n### $1\n\n');
  md = md.replace(/<h4[^>]*>(.*?)<\/h4>/gis, '\n#### $1\n\n');
  md = md.replace(/<h5[^>]*>(.*?)<\/h5>/gis, '\n##### $1\n\n');
  md = md.replace(/<h6[^>]*>(.*?)<\/h6>/gis, '\n###### $1\n\n');

  // Bold & Italics
  md = md.replace(/<(?:strong|b)[^>]*>(.*?)<\/(?:strong|b)>/gis, '**$1**');
  md = md.replace(/<(?:em|i)[^>]*>(.*?)<\/(?:em|i)>/gis, '*$1*');

  // Code Blocks and Inline Code
  md = md.replace(/<pre[^>]*><code[^>]*>(.*?)<\/code><\/pre>/gis, '\n```\n$1\n```\n\n');
  md = md.replace(/<code[^>]*>(.*?)<\/code>/gis, '`$1`');

  // Hyperlinks
  md = md.replace(/<a\s+(?:[^>]*?\s+)?href="([^"]*)"[^>]*>(.*?)<\/a>/gis, '[$2]($1)');

  // List Items
  md = md.replace(/<li[^>]*>(.*?)<\/li>/gis, '- $1\n');
  md = md.replace(/<\/?(?:ul|ol)[^>]*>/gis, '\n');

  // Blockquotes
  md = md.replace(/<blockquote[^>]*>(.*?)<\/blockquote>/gis, (match, p1) => {
    const cleanLines = p1.trim().split('\n').map(l => `> ${l.trim()}`).join('\n');
    return `\n${cleanLines}\n\n`;
  });

  // Paragraphs, Horizontal Rules & Breaks
  md = md.replace(/<p[^>]*>(.*?)<\/p>/gis, '$1\n\n');
  md = md.replace(/<br\s*\/?>/gis, '\n');
  md = md.replace(/<hr\s*\/?>/gis, '\n---\n\n');

  // Strip remaining HTML tags
  md = md.replace(/<[^>]+>/g, '');

  // Decode common HTML entities
  md = md.replace(/&nbsp;/g, ' ')
         .replace(/&amp;/g, '&')
         .replace(/&lt;/g, '<')
         .replace(/&gt;/g, '>')
         .replace(/&quot;/g, '"')
         .replace(/&#39;/g, "'");

  // Normalize excessive newlines
  md = md.replace(/\n{3,}/g, '\n\n');

  return md.trim();
}

/**
 * Minimal HTML entity escaping for fallback rendering.
 * @param {string} str 
 * @returns {string}
 */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const ConverterService = {
  /**
   * Extract textual content from a PDF File and format it as Markdown.
   * Uses window.pdfjsLib loaded from CDN.
   * 
   * @param {File|Blob} file 
   * @returns {Promise<string>}
   */
  async pdfToMarkdown(file) {
    if (typeof window === 'undefined' || !window.pdfjsLib) {
      throw new Error('PDF.js library (window.pdfjsLib) is not loaded.');
    }

    // Ensure worker source is configured
    if (!window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
    }

    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = window.pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;

    const pages = [];

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();

      let lastY = null;
      let pageText = '';

      for (const item of textContent.items) {
        if (lastY !== null && Math.abs(item.transform[5] - lastY) > 5) {
          pageText += '\n';
        } else if (pageText.length > 0 && !pageText.endsWith('\n') && !pageText.endsWith(' ')) {
          pageText += ' ';
        }
        pageText += item.str;
        lastY = item.transform[5];
      }

      const trimmedText = pageText.trim();
      if (pdf.numPages > 1) {
        pages.push(`## Page ${pageNum}\n\n${trimmedText}`);
      } else {
        pages.push(trimmedText);
      }
    }

    return pages.join('\n\n---\n\n');
  },

  /**
   * Convert a DOCX file to Markdown using window.mammoth.
   * 
   * @param {File|Blob} file 
   * @returns {Promise<string>}
   */
  async docxToMarkdown(file) {
    if (typeof window === 'undefined' || !window.mammoth) {
      throw new Error('Mammoth.js library (window.mammoth) is not loaded.');
    }

    const arrayBuffer = await file.arrayBuffer();
    const result = await window.mammoth.convertToHtml({ arrayBuffer });
    return htmlToMarkdown(result.value);
  },

  /**
   * Unified file converter detecting extension/MIME type.
   * Supports .pdf, .docx, .md, .txt.
   * 
   * @param {File} file 
   * @returns {Promise<{ markdown: string, title: string }>}
   */
  async convertFile(file) {
    if (!file) throw new Error('No file provided for conversion');

    // Extract title from file name without extension
    const title = file.name ? file.name.replace(/\.[^/.]+$/, '') : 'Sans titre';
    const lowerName = (file.name || '').toLowerCase();
    const mimeType = (file.type || '').toLowerCase();

    let markdown = '';

    if (lowerName.endsWith('.pdf') || mimeType === 'application/pdf') {
      markdown = await this.pdfToMarkdown(file);
    } else if (
      lowerName.endsWith('.docx') ||
      mimeType.includes('wordprocessingml') ||
      mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ) {
      markdown = await this.docxToMarkdown(file);
    } else if (
      lowerName.endsWith('.md') ||
      lowerName.endsWith('.txt') ||
      mimeType.startsWith('text/')
    ) {
      markdown = await file.text();
    } else {
      // Attempt reading as text fallback
      try {
        markdown = await file.text();
      } catch (err) {
        throw new Error(`Format de fichier non pris en charge (${file.name}). Utilisez un fichier PDF, DOCX ou Markdown.`);
      }
    }

    return {
      markdown,
      title
    };
  },

  /**
   * Parse a Markdown string into HTML using window.marked configured with GitHub Flavored Markdown (GFM).
   * 
   * Steps executed:
   * (1) Configure marked with GFM
   * (2) Parse markdown to HTML
   * (3) Return HTML
   * 
   * @param {string} markdownString 
   * @returns {string} htmlString
   */
  renderMarkdown(markdownString = '') {
    if (typeof window !== 'undefined' && window.marked) {
      // (1) Configure marked with GFM
      if (typeof window.marked.setOptions === 'function') {
        window.marked.setOptions({
          gfm: true,
          breaks: true,
          headerIds: false,
          mangle: false
        });
      }

      // (2) Parse markdown to HTML
      let html = '';
      if (typeof window.marked.parse === 'function') {
        html = window.marked.parse(markdownString || '');
      } else if (typeof window.marked === 'function') {
        html = window.marked(markdownString || '');
      }

      // (3) Return HTML
      return html;
    }

    // Safe fallback if marked is unavailable
    return escapeHtml(markdownString || '').replace(/\n/g, '<br>');
  },

  /**
   * Render mathematical formulas inside a DOM container element using KaTeX auto-render.
   * Delimiters configured for $...$ (inline) and $$...$$ (display math).
   * 
   * @param {HTMLElement} element - Target container element to search and render math in
   * @returns {void}
   */
  renderMathInElement(element) {
    if (!element || typeof window === 'undefined') return;

    if (typeof window.renderMathInElement === 'function') {
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
        console.warn('[ConverterService] renderMathInElement failed:', err);
      }
    }
  },

  /**
   * Calculate total character count of a Markdown string.
   * 
   * @param {string} markdownString 
   * @returns {number}
   */
  getCharCount(markdownString = '') {
    return typeof markdownString === 'string' ? markdownString.length : 0;
  }
};
