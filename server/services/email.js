function resetEmailHtml(resetLink) {
  return `<!DOCTYPE html>
<html lang="uk">
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f1729;color:#e8edf8;padding:32px 20px;margin:0">
  <div style="max-width:460px;margin:0 auto;background:#1a2744;border-radius:16px;padding:32px 28px;text-align:center">
    <div style="font-size:36px;margin-bottom:12px">🔑</div>
    <h2 style="color:#e85249;margin:0 0 10px;font-size:20px">Відновлення пароля</h2>
    <p style="color:#c8d4e8;margin:0 0 24px;font-size:14px;line-height:1.55">
      Ми отримали запит на відновлення пароля для вашого акаунта <strong>BP&nbsp;&amp;&nbsp;BMI</strong>.<br>
      Посилання дійсне протягом <strong>1 години</strong>.
    </p>
    <a href="${resetLink}"
       style="display:inline-block;background:#e85249;color:#fff;text-decoration:none;padding:14px 32px;border-radius:12px;font-size:15px;font-weight:600">
      Змінити пароль
    </a>
    <p style="color:#4a5f8a;margin:24px 0 0;font-size:12px;line-height:1.5">
      Якщо ви не запитували відновлення — просто проігноруйте цей лист.<br>
      Ваш пароль залишиться незмінним.
    </p>
  </div>
</body>
</html>`;
}

async function sendResetEmail(to, resetLink) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[email] RESEND_API_KEY not set — email not sent. Reset link:', resetLink);
    return;
  }
  const from = process.env.RESEND_FROM || 'BP & BMI <no-reply@bpbmi.pp.ua>';
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: 'Відновлення пароля — BP & BMI',
      html: resetEmailHtml(resetLink),
    }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`Resend API error ${r.status}: ${body}`);
  }
}

module.exports = { sendResetEmail };
