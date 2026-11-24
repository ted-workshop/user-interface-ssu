import { describe, expect, test } from "vitest";
import { renderReportEmail } from "../src/report-mail";

describe("리포트 메일 HTML", () => {
  test("제목과 마크다운 구조를 인라인 스타일 HTML로 렌더링해요", () => {
    const html = renderReportEmail(
      "테스트 <영상>",
      `## 3줄 요약
1. 첫째 **핵심** 내용이에요.
2. 둘째 [장면](https://www.youtube.com/watch?v=abc&t=42s)이에요.

## 서론
> 인용문이에요.

| 항목 | 값 |
| --- | --- |
| 하나 | 둘 |

\`\`\`
<script>alert(1)</script>
\`\`\`
`,
    );

    expect(html).toContain("<!doctype html>");
    expect(html).toContain("테스트 &lt;영상&gt;");
    expect(html).toContain("<h2 style=");
    expect(html).toContain("<ol");
    expect(html).toContain("<strong style=");
    expect(html).toContain(
      'href="https://www.youtube.com/watch?v=abc&amp;t=42s"',
    );
    expect(html).toContain("<blockquote");
    expect(html).toContain("<table");
    expect(html).toContain("<th style=");
    expect(html).toContain("<pre");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });

  test("원문 HTML과 안전하지 않은 링크, 원격 이미지를 실행하지 않아요", () => {
    const html = renderReportEmail(
      "제목",
      `<img src="https://example.com/pixel.png" onerror="alert(1)">

[위험](javascript:alert(1)) [파일](file:///etc/passwd) ![추적](https://example.com/pixel.png)`,
    );

    expect(html).not.toContain("<img");
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('href="file:');
    expect(html).toContain("&lt;img");
    expect(html).toContain("위험");
    expect(html).toContain("파일");
    expect(html).toContain("[이미지] 추적");
  });
});
