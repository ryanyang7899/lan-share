'use strict';

const $ = (sel) => document.querySelector(sel);
const form = $('#login-form');
const msg = $('#login-msg');
const btn = $('#login-btn');
const userInput = $('#login-user');
const passInput = $('#login-pass');

let countdownTimer = null;

function showMsg(text, type) {
  msg.textContent = text;
  msg.className = `login-msg ${type || 'error'}`;
}

// 锁定时显示倒计时，让用户知道还要等多久
function startCountdown(ms) {
  let left = ms;
  clearInterval(countdownTimer);
  const tick = () => {
    if (left <= 0) {
      clearInterval(countdownTimer);
      showMsg('锁定已解除，可以重新尝试登录', 'ok');
      btn.disabled = false;
      return;
    }
    const h = Math.floor(left / 3600000);
    const m = Math.floor((left % 3600000) / 60000);
    const s = Math.floor((left % 60000) / 1000);
    const parts = h > 0 ? `${h} 小时 ${m} 分钟` : m > 0 ? `${m} 分 ${s} 秒` : `${s} 秒`;
    showMsg(`该 IP 已被锁定，剩余 ${parts}`, 'error');
    left -= 1000;
  };
  btn.disabled = true;
  tick();
  countdownTimer = setInterval(tick, 1000);
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearInterval(countdownTimer);

  const username = userInput.value.trim();
  const password = passInput.value;
  if (!username || !password) {
    showMsg('请输入账户名和密码', 'error');
    return;
  }

  btn.disabled = true;
  showMsg('登录中…', 'info');

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json().catch(() => ({}));

    if (res.ok) {
      showMsg('登录成功，正在进入…', 'ok');
      location.href = '/';
      return;
    }

    // 已被锁定：进入倒计时，期间禁止提交
    if (res.status === 403 && data.locked) {
      startCountdown(Number(data.remainingMs) || 0);
      return;
    }

    showMsg(data.error || '登录失败', 'error');
    btn.disabled = false;
    passInput.value = '';
    passInput.focus();
  } catch (err) {
    showMsg('网络错误，请检查连接后重试', 'error');
    btn.disabled = false;
  }
});

// 若该 IP 已被锁定，进入页面即提示
(async () => {
  try {
    const res = await fetch('/api/me');
    if (res.ok) {
      location.href = '/'; // 已登录，直接进入
    }
  } catch {
    /* 忽略：未登录时正常停留在登录页 */
  }
})();
