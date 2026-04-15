/**
 * Netscape Bookmark File Format parser.
 *
 * Chrome's "Export bookmarks" produces this format. Spec is loose but the
 * structure is well-known:
 *
 *   <DL><p>
 *     <DT><H3 ADD_DATE="..." LAST_MODIFIED="...">Folder Name</H3>
 *     <DL><p>
 *       <DT><A HREF="https://..." ADD_DATE="..." ICON="data:...">Title</A>
 *     </DL><p>
 *   </DL><p>
 *
 * We track folder depth with a stack so each bookmark gets a "/Folder/Sub"
 * folder_path. Only an optional folder filter is needed if Jonathan wants
 * just a specific group.
 */

function parseBookmarksHtml(html, opts = {}) {
  const folderFilter = (opts.folderFilter || '').toLowerCase().trim() || null;
  const items = [];
  const folderStack = [];

  // Tokenize by matching either a folder header (<H3>...</H3>),
  // a bookmark anchor (<A HREF=...>title</A>), or a folder close (</DL>).
  // Optional leading <DT> is allowed but not required (Chrome includes it,
  // some exporters don't).
  const tagRegex = /(?:<DT>\s*)?<(H3|A)\b([^>]*)>([\s\S]*?)<\/\1>|<\/DL>/gi;
  let m;
  while ((m = tagRegex.exec(html)) !== null) {
    if (m[0].toUpperCase().startsWith('</DL')) {
      folderStack.pop();
      continue;
    }
    const tag = (m[1] || '').toUpperCase();
    const attrs = m[2] || '';
    const text = (m[3] || '').replace(/<[^>]+>/g, '').trim();

    if (tag === 'H3') {
      folderStack.push(decodeEntities(text));
    } else if (tag === 'A') {
      const href = matchAttr(attrs, 'HREF');
      if (!href) continue;
      const folderPath = folderStack.length ? '/' + folderStack.join('/') : '/';
      if (folderFilter && !folderPath.toLowerCase().includes(folderFilter)) continue;
      items.push({
        name: decodeEntities(text) || href,
        url: href,
        folder_path: folderPath,
        favicon_url: matchAttr(attrs, 'ICON') || null,
        add_date: matchAttr(attrs, 'ADD_DATE') || null
      });
    }
  }
  return items;
}

function matchAttr(attrs, name) {
  const re = new RegExp(name + '\\s*=\\s*"([^"]*)"', 'i');
  const m = attrs.match(re);
  return m ? m[1] : null;
}

function decodeEntities(s) {
  if (!s) return s;
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/**
 * Parses a plain-text URL list (one per line). Lines may be just a URL,
 * or "Title<TAB>URL", or "Title — URL", or markdown "[Title](URL)".
 */
function parseUrlList(text, opts = {}) {
  const items = [];
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const folder = opts.folder || '/Imported';
  for (const line of lines) {
    let name = '', url = '';
    let mdMatch = line.match(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/);
    if (mdMatch) { name = mdMatch[1]; url = mdMatch[2]; }
    else if (/\t/.test(line)) {
      const [n, u] = line.split('\t');
      name = (n || '').trim();
      url  = (u || '').trim();
    } else if (/\s+—\s+|\s+-\s+/.test(line) && /https?:\/\//.test(line)) {
      const m = line.match(/^(.*?)\s+(?:—|-)\s+(https?:\S+)/);
      if (m) { name = m[1].trim(); url = m[2].trim(); }
    } else if (/^https?:\/\//.test(line)) {
      url = line;
      try { name = new URL(line).hostname.replace(/^www\./, ''); } catch (e) { name = line; }
    } else {
      continue;
    }
    if (!url) continue;
    items.push({ name, url, folder_path: folder, favicon_url: null });
  }
  return items;
}

module.exports = { parseBookmarksHtml, parseUrlList };
