import axios from 'axios';
import * as cheerio from 'cheerio';

export async function fetchMetadata(url, timeoutMs = 12000) {
  const response = await axios.get(url, {
    timeout: timeoutMs,
    maxRedirects: 5,
    headers: { 'User-Agent': 'Mozilla/5.0 VisualBookmarksBot/1.0' }
  });

  const finalUrl = response.request?.res?.responseUrl || url;
  const contentType = response.headers['content-type'] || '';

  // 防禦：如果不是 HTML (例如直接連到 PDF 或圖片)，跳過 cheerio 解析避免當機
  if (!contentType.includes('text/html')) {
    return { finalUrl, title: null, description: null, siteName: null, ogImage: null, favicon: null };
  }

  const html = response.data;
  const $ = cheerio.load(html);
  const getMeta = (selector, attr = 'content') => $(selector).attr(attr) || null;

  return {
    finalUrl,
    title: $('title').first().text().trim() || null,
    description: getMeta('meta[name="description"]') || getMeta('meta[property="og:description"]'),
    siteName: getMeta('meta[property="og:site_name"]'),
    ogImage: getMeta('meta[property="og:image"]'),
    favicon: $('link[rel="icon"]').attr('href') || $('link[rel="shortcut icon"]').attr('href')
  };
}