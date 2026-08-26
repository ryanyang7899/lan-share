// Markdown 渲染：marked + DOMPurify（本地 vendor，零 CDN）
// - 所有用户提交的内容都经过 sanitize，防 XSS
// - 链接统一开新标签 + noopener，自动转安全协议
// - breaks:true 让单换行即 <br>，符合聊天/公告习惯
(function () {
  if (typeof marked === 'undefined' || typeof DOMPurify === 'undefined') return;

  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });

  // 输入 → 安全的 HTML 字符串（无 <script>、无 javascript: 链接）
  window.md = (text) => {
    const raw = marked.parse(String(text == null ? '' : text), { breaks: true, gfm: true });
    return DOMPurify.sanitize(raw);
  };
})();