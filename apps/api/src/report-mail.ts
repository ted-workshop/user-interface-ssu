import { Marked, type RendererObject } from "marked";

// Qletter Android 화면과 같은 흑백 팔레트를 메일에서도 유지해요.
const FONT =
  "'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', system-ui, -apple-system, 'Segoe UI', sans-serif";
const MONO = "'SFMono-Regular', Consolas, 'Liberation Mono', monospace";
const INK = "#0D0D0D";
const BODY_INK = "#404040";
const MUTED = "#767676";
const LINE = "#E8E8E8";
const SOFT = "#F7F7F8";

const fontFamily = `font-family:${FONT};`;
const bodyText = `${fontFamily}font-size:16px;line-height:1.75;color:${BODY_INK};overflow-wrap:break-word;`;
// 문단은 부모의 글자색을 상속해 인용문 안에서도 같은 색을 유지해요.
const paragraphText = `${fontFamily}font-size:16px;line-height:1.75;`;

const renderer: RendererObject = {
  // 본문 제목은 메일 제목 아래에 오므로 h1을 만들지 않고 h2부터 사용해요.
  heading({ tokens, depth }) {
    const level = Math.max(2, Math.min(depth, 4));
    const size = level === 2 ? "21px" : level === 3 ? "18px" : "16px";
    return `<h${level} style="margin:32px 0 12px;${fontFamily}font-size:${size};line-height:1.4;font-weight:700;color:${INK};">${this.parser.parseInline(tokens)}</h${level}>`;
  },
  paragraph({ tokens }) {
    return `<p style="margin:0 0 16px;${paragraphText}">${this.parser.parseInline(tokens)}</p>`;
  },
  blockquote({ tokens }) {
    return `<blockquote style="margin:20px 0;padding:14px 18px;background:${SOFT};border-left:3px solid #D6D6D6;border-radius:0 8px 8px 0;${fontFamily}font-size:16px;line-height:1.75;color:#5D5D5D;">${this.parser.parse(tokens)}</blockquote>`;
  },
  hr() {
    return `<hr style="margin:28px 0;border:0;border-top:1px solid ${LINE};">`;
  },
  list({ items, ordered, start }) {
    const tag = ordered ? "ol" : "ul";
    const startAttribute = ordered && start !== 1 ? ` start="${start}"` : "";
    return `<${tag}${startAttribute} style="margin:0 0 16px;padding-left:22px;${bodyText}">${items
      .map((item) => this.listitem(item))
      .join("")}</${tag}>`;
  },
  listitem(item) {
    return `<li style="margin:0 0 6px;">${this.parser.parse(item.tokens)}</li>`;
  },
  strong({ tokens }) {
    return `<strong style="font-weight:700;color:${INK};">${this.parser.parseInline(tokens)}</strong>`;
  },
  em({ tokens }) {
    return `<em style="font-style:italic;">${this.parser.parseInline(tokens)}</em>`;
  },
  del({ tokens }) {
    return `<del>${this.parser.parseInline(tokens)}</del>`;
  },
  codespan({ text }) {
    return `<code style="padding:2px 5px;background:${SOFT};border:1px solid ${LINE};border-radius:4px;font-family:${MONO};font-size:14px;color:${INK};">${escapeHtml(text)}</code>`;
  },
  code({ text, escaped }) {
    return `<pre style="margin:0 0 16px;padding:16px;background:${SOFT};border:1px solid ${LINE};border-radius:8px;overflow-x:auto;font-family:${MONO};font-size:14px;line-height:1.6;color:${INK};"><code>${escaped ? text : escapeHtml(text)}</code></pre>`;
  },
  link({ href, title, tokens }) {
    const text = this.parser.parseInline(tokens);
    const url = safeHref(href);
    if (!url) return text;
    const titleAttribute = title ? ` title="${escapeHtml(title)}"` : "";
    return `<a href="${escapeHtml(url)}"${titleAttribute} style="color:${INK};text-decoration:underline;">${text}</a>`;
  },
  // 리포트 본문의 이미지는 원격 추적을 막기 위해 불러오지 않고 대체 문구만 보여줘요.
  image({ text }) {
    return `<span style="color:${MUTED};">${escapeHtml(text ? `[이미지] ${text}` : "[이미지]")}</span>`;
  },
  table(token) {
    const head = token.header.map((cell) => this.tablecell(cell)).join("");
    const body = token.rows
      .map(
        (row) => `<tr>${row.map((cell) => this.tablecell(cell)).join("")}</tr>`,
      )
      .join("");
    return `<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;border-collapse:collapse;${bodyText}"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
  },
  tablecell({ tokens, header }) {
    const tag = header ? "th" : "td";
    const headStyle = header
      ? `font-weight:700;color:${INK};background:${SOFT};`
      : "";
    return `<${tag} style="padding:10px 12px;border:1px solid ${LINE};text-align:left;vertical-align:top;${headStyle}">${this.parser.parseInline(tokens)}</${tag}>`;
  },
  // 모델이 출력한 원문 HTML은 실행하지 않고 글자로만 보여줘요.
  html({ text }) {
    return escapeHtml(text);
  },
};

const markdown = new Marked({ gfm: true, breaks: false }).use({ renderer });

export function renderReportEmail(title: string, bodyMarkdown: string) {
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:${SOFT};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${SOFT};">
<tr>
<td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#FFFFFF;border:1px solid ${LINE};border-top:4px solid ${INK};border-radius:16px;">
<tr>
<td style="padding:28px 32px 0;">
<p style="margin:0;font-family:${FONT};font-size:12px;line-height:1.5;font-weight:700;letter-spacing:0.12em;color:${MUTED};">QLETTER · 채널 자동 요약</p>
<h1 style="margin:10px 0 20px;font-family:${FONT};font-size:24px;line-height:1.4;font-weight:700;color:${INK};">${escapeHtml(title)}</h1>
</td>
</tr>
<tr>
<td style="padding:0 32px 8px;${bodyText}">
${markdown.parse(bodyMarkdown, { async: false })}
</td>
</tr>
<tr>
<td style="padding:0 32px 28px;">
<hr style="margin:0 0 16px;border:0;border-top:1px solid ${LINE};">
<p style="margin:0;font-family:${FONT};font-size:13px;line-height:1.6;color:${MUTED};">AI가 작성한 리포트예요. 중요한 내용은 원본 영상과 함께 확인해 주세요.</p>
</td>
</tr>
</table>
</td>
</tr>
</table>
</body>
</html>`;
}

function safeHref(value: string) {
  const url = URL.parse(value);
  if (
    !url ||
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username ||
    url.password
  )
    return null;
  return url.href;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
