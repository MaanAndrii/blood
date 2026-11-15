const assert = require('node:assert/strict');
const { generatePdf } = require('../server/services/pdf');

async function main() {
  const user = { name: 'Тестовий запис', date_of_birth: '1980-01-01', sex: 'male' };
  const date = '2026-01-15';
  const entries = [{
    date, m_sys_l: 121, m_dia_l: 79, m_pulse: 68,
    e_sys_l: 118, e_dia_l: 77, e_pulse: 66,
    weight: '75.0', notes: 'Тестова нотатка',
  }];
  const labs = [{ date, total_chol: '4.50', hdl: '1.40' }];

  for (const mode of ['short', 'extended']) {
    const pdf = Buffer.from(await generatePdf(user, entries, labs, date, date, mode));
    assert.equal(pdf.toString('ascii', 0, 5), '%PDF-', mode);
    console.log(`PDF ${mode}: OK (${pdf.length} bytes)`);
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
